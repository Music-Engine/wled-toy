mod osc;
mod packets;
mod wled;

use std::collections::{HashMap, VecDeque};
use std::io::ErrorKind;
use std::net::{SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::{State, WebviewWindow};

use osc::{parse_osc, OscMessage};
use packets::{build_frame, next_seq, Protocol};

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Info,
    Warn,
    Error,
}

/// What the bridge tells the page: the JSON messages of the Node bridge (bridge.ts), plus `drop`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Message {
    /// The `count` frames sent since the last ack, up to `frame_id`: `udp_ms` is their mean, `bytes` their sum.
    #[serde(rename_all = "camelCase")]
    Ack {
        frame_id: u32,
        count: u32,
        udp_ms: f64,
        bytes: usize,
    },
    /// A frame that left the queue unsent because newer ones arrived faster than UDP took them.
    #[serde(rename_all = "camelCase")]
    Drop {
        frame_id: u32,
    },
    Log {
        level: Level,
        msg: String,
    },
    #[serde(rename_all = "camelCase")]
    Device {
        name: String,
        version: String,
        led_count: u32,
    },
    Ping {
        ms: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        fps: Option<f64>,
    },
    Osc(OscMessage),
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    host: String,
    protocol: String,
    universe: Option<f64>,
    osc_port: Option<f64>,
}

type Emit = Arc<dyn Fn(Message) + Send + Sync>;

/// Frames waiting for the UDP thread. A stale LED frame is worse than a skipped one, so a full queue gives up its oldest frame.
#[derive(Default)]
struct FrameQueue {
    state: Mutex<(VecDeque<Vec<u8>>, bool)>,
    ready: Condvar,
}

impl FrameQueue {
    /// Returns the frame that had to make room, if any.
    fn push(&self, frame: Vec<u8>) -> Option<Vec<u8>> {
        let mut state = self.state.lock().unwrap();
        let dropped = if state.0.len() >= 2 {
            state.0.pop_front()
        } else {
            None
        };
        state.0.push_back(frame);
        self.ready.notify_one();
        dropped
    }

    /// Blocks until a frame arrives, the queue is closed, or `until` passes.
    fn pop(&self, until: Option<Instant>) -> Next {
        let mut state = self.state.lock().unwrap();
        loop {
            if state.1 {
                return Next::Closed;
            }
            if let Some(frame) = state.0.pop_front() {
                return Next::Frame(frame);
            }
            state = match until {
                None => self.ready.wait(state).unwrap(),
                Some(until) => {
                    let left = until.saturating_duration_since(Instant::now());
                    if left.is_zero() {
                        return Next::Idle;
                    }
                    self.ready.wait_timeout(state, left).unwrap().0
                }
            };
        }
    }

    fn close(&self) {
        self.state.lock().unwrap().1 = true;
        self.ready.notify_all();
    }
}

#[derive(Debug, PartialEq)]
enum Next {
    Frame(Vec<u8>),
    Idle,
    Closed,
}

/// Acks of the frames sent since the last flush: one Channel message per interval instead of one per frame.
#[derive(Default)]
struct Acks {
    since: Option<Instant>,
    last_id: u32,
    count: u32,
    udp_ms: f64,
    bytes: usize,
}

impl Acks {
    const INTERVAL: Duration = Duration::from_millis(100);

    fn add(&mut self, now: Instant, frame_id: u32, udp_ms: f64, bytes: usize) {
        self.since.get_or_insert(now);
        self.last_id = frame_id;
        self.count += 1;
        self.udp_ms += udp_ms;
        self.bytes += bytes;
    }

    /// When the pending acks are due, so the last frames of a stream are acked one interval after the first of them.
    fn due(&self) -> Option<Instant> {
        self.since.map(|since| since + Self::INTERVAL)
    }

    fn take(&mut self) -> Option<Message> {
        self.since?;
        let acks = std::mem::take(self);
        Some(Message::Ack {
            frame_id: acks.last_id,
            count: acks.count,
            udp_ms: acks.udp_ms / f64::from(acks.count),
            bytes: acks.bytes,
        })
    }
}

#[derive(Clone, Copy, Default)]
struct Target {
    has_host: bool,
    protocol: Protocol,
    universe: u16,
    addr: Option<SocketAddr>,
}

struct Shared {
    emit: Emit,
    port_of: Box<dyn Fn(Protocol) -> u16 + Send + Sync>,
    frames: FrameQueue,
    target: Mutex<Target>,
    host: Mutex<String>,
    // bumped by every config and by close: work started under an older value stops or discards its result
    generation: AtomicU64,
    osc: Mutex<(u16, Arc<AtomicBool>)>,
}

impl Shared {
    fn log(&self, level: Level, msg: String) {
        (self.emit)(Message::Log { level, msg });
    }

    fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation
    }
}

/// One page's bridge: what a WebSocket connection is to the Node bridge. Dropping it stops its threads.
pub struct Connection(Arc<Shared>);

impl Connection {
    /// `port_of` is `Protocol::port` outside of tests, which cannot bind the well-known ports.
    pub fn open(
        emit: Emit,
        port_of: impl Fn(Protocol) -> u16 + Send + Sync + 'static,
    ) -> std::io::Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0")?;
        let shared = Arc::new(Shared {
            emit,
            port_of: Box::new(port_of),
            frames: FrameQueue::default(),
            target: Mutex::default(),
            host: Mutex::default(),
            generation: AtomicU64::new(0),
            osc: Mutex::default(),
        });
        let for_sender = shared.clone();
        thread::Builder::new()
            .name("bridge-udp".into())
            .spawn(move || send_frames(&for_sender, &socket))?;
        Ok(Self(shared))
    }

    pub fn configure(&self, config: Config) {
        let shared = &self.0;
        let integer = |value: Option<f64>| value.filter(|v| v.fract() == 0.0);
        listen_osc(
            shared,
            integer(config.osc_port)
                .filter(|port| (1.0..65536.0).contains(port))
                .map_or(0, |port| port as u16),
        );
        let generation = shared.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let host = config.host.trim().to_string();
        let protocol = Protocol::parse(&config.protocol);
        *shared.target.lock().unwrap() = Target {
            has_host: !host.is_empty(),
            protocol,
            universe: integer(config.universe).map_or(0, |u| u.clamp(0.0, 32767.0) as u16),
            addr: None,
        };
        shared.host.lock().unwrap().clone_from(&host);
        if host.is_empty() {
            return shared.log(
                Level::Warn,
                "No host configured; frames are preview only".into(),
            );
        }
        shared.log(
            Level::Info,
            format!("Target {host} via {}", protocol.name().to_uppercase()),
        );
        let shared = shared.clone();
        thread::spawn(move || {
            resolve(&shared, generation);
            watch_device(&shared, generation, &host, protocol);
        });
    }

    /// `frame` is the page's binary message: a uint32 LE frame id, then RGB bytes.
    pub fn send_frame(&self, frame: Vec<u8>) {
        if let Some(dropped) = self.0.frames.push(frame) {
            if let Some(frame_id) = frame_id(&dropped) {
                (self.0.emit)(Message::Drop { frame_id });
            }
        }
    }
}

impl Drop for Connection {
    fn drop(&mut self) {
        self.0.generation.fetch_add(1, Ordering::SeqCst);
        self.0.frames.close();
        self.0.osc.lock().unwrap().1.store(true, Ordering::SeqCst);
    }
}

fn frame_id(frame: &[u8]) -> Option<u32> {
    Some(u32::from_le_bytes(frame.get(..4)?.try_into().ok()?))
}

fn send_frames(shared: &Arc<Shared>, socket: &UdpSocket) {
    let mut cid = [0u8; 16];
    // the CID only has to differ between senders, so an all zero one after a failure still streams
    let _ = getrandom::fill(&mut cid);
    let mut seq = 1;
    let mut last_error: Option<Instant> = None;
    let mut acks = Acks::default();
    loop {
        let frame = match shared.frames.pop(acks.due()) {
            Next::Frame(frame) => frame,
            Next::Idle => {
                if let Some(ack) = acks.take() {
                    (shared.emit)(ack);
                }
                continue;
            }
            Next::Closed => return,
        };
        let Some(frame_id) = frame_id(&frame) else {
            continue;
        };
        let started = Instant::now();
        let target = *shared.target.lock().unwrap();
        let mut bytes = 0;
        if target.has_host {
            let packets = build_frame(target.protocol, &frame[4..], seq, target.universe, &cid);
            seq = next_seq(seq);
            // until the host resolves there is nowhere to send; the sequence still advances as it does in the Node bridge
            let failure = target.addr.and_then(|addr| {
                packets
                    .iter()
                    .find_map(|packet| socket.send_to(packet, addr).map(|sent| bytes += sent).err())
            });
            if let Some(error) = failure {
                // a dead route fails every frame: one log line and one fresh lookup per 2 seconds is enough
                if !last_error.is_some_and(|at| at.elapsed() <= Duration::from_secs(2)) {
                    last_error = Some(Instant::now());
                    shared.log(Level::Error, format!("UDP error: {error}"));
                    let shared = shared.clone();
                    let generation = shared.generation.load(Ordering::SeqCst);
                    thread::spawn(move || resolve(&shared, generation));
                }
            }
        }
        let now = Instant::now();
        acks.add(now, frame_id, (now - started).as_secs_f64() * 1000.0, bytes);
        if acks.due().is_some_and(|due| now >= due) {
            if let Some(ack) = acks.take() {
                (shared.emit)(ack);
            }
        }
    }
}

/// Looks the host up (the system resolver, so mDNS `.local` names work on macOS) and caches the address for the UDP thread.
fn resolve(shared: &Shared, generation: u64) {
    let host = shared.host.lock().unwrap().clone();
    let port = (shared.port_of)(shared.target.lock().unwrap().protocol);
    // the socket is IPv4, as the Node bridge's udp4 socket is
    let found = (host.as_str(), port)
        .to_socket_addrs()
        .map(|mut addrs| addrs.find(SocketAddr::is_ipv4));
    if !shared.is_current(generation) {
        return;
    }
    match found {
        Ok(Some(addr)) => shared.target.lock().unwrap().addr = Some(addr),
        Ok(None) => shared.log(
            Level::Error,
            format!("UDP error: {host} has no IPv4 address"),
        ),
        Err(error) => shared.log(
            Level::Error,
            format!("UDP error: cannot resolve {host}: {error}"),
        ),
    }
}

/// The WLED HTTP probe, then a ping every 2 seconds until a newer config or the close.
fn watch_device(shared: &Shared, generation: u64, host: &str, protocol: Protocol) {
    let client = wled::Client::new(host);
    let probe = client.info();
    if !shared.is_current(generation) {
        return;
    }
    match probe {
        Ok(info) => {
            let fps = info
                .leds
                .fps
                .map_or("unknown".into(), |fps| fps.to_string());
            shared.log(
                Level::Info,
                format!(
                    "WLED \"{}\" v{}, {} LEDs, fps {fps}",
                    info.name, info.version, info.leds.count
                ),
            );
            (shared.emit)(Message::Device {
                name: info.name,
                version: info.version,
                led_count: info.leds.count,
            });
        }
        // Art-Net and sACN receivers need not be WLED; without its API there is just no device info or ping
        Err(_) if matches!(protocol, Protocol::Artnet | Protocol::Sacn) => {
            return shared.log(
                Level::Info,
                format!("No WLED API at {host}; sending {} anyway", protocol.name()),
            );
        }
        Err(error) => {
            return shared.log(
                Level::Error,
                format!("Could not reach WLED at {host}: {error}"),
            )
        }
    }
    loop {
        let started = Instant::now();
        let info = client.info();
        if !shared.is_current(generation) {
            return;
        }
        (shared.emit)(match info {
            Ok(info) => Message::Ping {
                ms: Some(started.elapsed().as_secs_f64() * 1000.0),
                fps: info.leds.fps,
            },
            Err(_) => Message::Ping {
                ms: None,
                fps: None,
            },
        });
        thread::sleep(Duration::from_secs(2).saturating_sub(started.elapsed()));
    }
}

fn listen_osc(shared: &Arc<Shared>, port: u16) {
    let mut osc = shared.osc.lock().unwrap();
    if osc.0 == port {
        return;
    }
    osc.1.store(true, Ordering::SeqCst);
    let stop = Arc::new(AtomicBool::new(false));
    *osc = (port, stop.clone());
    if port == 0 {
        return;
    }
    let shared = shared.clone();
    thread::spawn(move || {
        // a listener that was just told to stop (a page reload) may hold the port for one more read timeout
        let mut bound = UdpSocket::bind(("0.0.0.0", port));
        for _ in 0..4 {
            if bound.is_ok() {
                break;
            }
            thread::sleep(Duration::from_millis(100));
            bound = UdpSocket::bind(("0.0.0.0", port));
        }
        let socket = match bound.and_then(|socket| {
            socket
                .set_read_timeout(Some(Duration::from_millis(200)))
                .map(|()| socket)
        }) {
            Ok(socket) => socket,
            Err(error) => return shared.log(Level::Error, format!("OSC listener: {error}")),
        };
        shared.log(Level::Info, format!("Listening for OSC on UDP {port}"));
        let mut packet = vec![0u8; 65536];
        while !stop.load(Ordering::SeqCst) {
            match socket.recv(&mut packet) {
                // a malformed packet from the network is dropped, not fatal
                Ok(length) => parse_osc(&packet[..length])
                    .unwrap_or_default()
                    .into_iter()
                    .for_each(|message| (shared.emit)(Message::Osc(message))),
                Err(error)
                    if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                Err(error) => return shared.log(Level::Error, format!("OSC listener: {error}")),
            }
        }
    });
}

/// One bridge per webview window: a reloaded page opens again and replaces its old connection.
#[derive(Default)]
pub struct Bridges(Mutex<HashMap<String, Connection>>);

#[tauri::command]
pub fn bridge_open(
    window: WebviewWindow,
    bridges: State<Bridges>,
    events: Channel<Message>,
) -> Result<(), String> {
    let emit: Emit = Arc::new(move |message| {
        // the page is gone when this fails, and its next open replaces the connection
        let _ = events.send(message);
    });
    let connection = Connection::open(emit, Protocol::port).map_err(|e| e.to_string())?;
    bridges
        .0
        .lock()
        .unwrap()
        .insert(window.label().to_string(), connection);
    Ok(())
}

#[tauri::command]
pub fn bridge_config(
    window: WebviewWindow,
    bridges: State<Bridges>,
    config: Config,
) -> Result<(), String> {
    bridges
        .0
        .lock()
        .unwrap()
        .get(window.label())
        .ok_or("bridge is not open")?
        .configure(config);
    Ok(())
}

/// The body is the raw frame, never JSON: see `Connection::send_frame`.
/// Async so it runs on the async runtime: a plain command runs on the main thread, once per LED frame.
#[tauri::command]
pub async fn bridge_frame(
    window: WebviewWindow,
    bridges: State<'_, Bridges>,
    request: Request<'_>,
) -> Result<(), String> {
    let InvokeBody::Raw(frame) = request.body() else {
        return Err("a frame is a binary body".into());
    };
    bridges
        .0
        .lock()
        .unwrap()
        .get(window.label())
        .ok_or("bridge is not open")?
        .send_frame(frame.clone());
    Ok(())
}

#[tauri::command]
pub fn bridge_close(window: WebviewWindow, bridges: State<Bridges>) {
    bridges.0.lock().unwrap().remove(window.label());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, Receiver};

    fn connect(port: u16) -> (Connection, Receiver<Message>) {
        let (sender, messages) = channel();
        let sender = Mutex::new(sender);
        let emit: Emit = Arc::new(move |message| {
            let _ = sender.lock().unwrap().send(message);
        });
        (Connection::open(emit, move |_| port).unwrap(), messages)
    }

    fn device() -> (UdpSocket, u16) {
        let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let port = socket.local_addr().unwrap().port();
        (socket, port)
    }

    fn frame(id: u32, rgb: &[u8]) -> Vec<u8> {
        [&id.to_le_bytes(), rgb].concat()
    }

    fn next_ack(messages: &Receiver<Message>) -> (u32, usize) {
        loop {
            if let Message::Ack {
                frame_id, bytes, ..
            } = messages
                .recv_timeout(Duration::from_secs(5))
                .expect("no ack")
            {
                return (frame_id, bytes);
            }
        }
    }

    /// Sends the frame until the lookup of the host has finished and one goes out; returns how many it took.
    fn send_until_on_the_wire(
        connection: &Connection,
        messages: &Receiver<Message>,
        first_id: u32,
        rgb: &[u8],
    ) -> u32 {
        for attempt in 0..500 {
            connection.send_frame(frame(first_id + attempt, rgb));
            let (frame_id, bytes) = next_ack(messages);
            assert_eq!(frame_id, first_id + attempt);
            if bytes > 0 {
                return attempt + 1;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("the host never resolved");
    }

    fn receive(device: &UdpSocket, count: usize) -> Vec<Vec<u8>> {
        let mut packet = [0u8; 2048];
        let mut next = || {
            let length = device.recv(&mut packet).expect("no datagram");
            packet[..length].to_vec()
        };
        (0..count).map(|_| next()).collect()
    }

    #[test]
    fn a_frame_arrives_as_the_packets_of_the_node_bridge_and_is_acked_with_their_size() {
        let (device, port) = device();
        let (connection, messages) = connect(port);
        let rgb: Vec<u8> = (0..3000).map(|i| ((i * 7 + 3) % 256) as u8).collect();
        let golden = packets::build_dnrgb(&rgb);

        connection.configure(Config {
            host: " 127.0.0.1 ".into(),
            protocol: "dnrgb".into(),
            ..Config::default()
        });
        let sent_frames = send_until_on_the_wire(&connection, &messages, 42, &rgb);

        assert_eq!(receive(&device, 3), golden);
        assert_eq!(golden.iter().map(Vec::len).sum::<usize>(), 3012);

        // every frame since the config advanced the sequence, sent or not; universes clamp to 15 bits
        connection.configure(Config {
            host: "127.0.0.1".into(),
            protocol: "artnet".into(),
            universe: Some(99999.0),
            osc_port: None,
        });
        let more_frames = send_until_on_the_wire(&connection, &messages, 1000, &rgb[..6]);
        let seq = (0..sent_frames + more_frames - 1).fold(1, |seq, _| next_seq(seq));
        assert_eq!(
            receive(&device, 1),
            packets::build_artnet(&rgb[..6], seq, 32767)
        );
    }

    #[test]
    fn without_a_host_frames_are_acked_and_nothing_is_sent() {
        let (connection, messages) = connect(9);
        connection.configure(Config::default());
        assert_eq!(
            messages.recv().unwrap(),
            Message::Log {
                level: Level::Warn,
                msg: "No host configured; frames are preview only".into()
            }
        );
        connection.send_frame(frame(7, &[1, 2, 3]));
        assert_eq!(next_ack(&messages), (7, 0));
    }

    #[test]
    fn a_full_queue_gives_up_its_oldest_frame() {
        let queue = FrameQueue::default();
        assert_eq!(queue.push(vec![1]), None);
        assert_eq!(queue.push(vec![2]), None);
        assert_eq!(queue.push(vec![3]), Some(vec![1]));
        assert_eq!(queue.pop(None), Next::Frame(vec![2]));
        assert_eq!(queue.pop(None), Next::Frame(vec![3]));
        assert_eq!(queue.pop(Some(Instant::now())), Next::Idle);
        queue.push(vec![4]);
        queue.close();
        assert_eq!(queue.pop(None), Next::Closed);
    }

    #[test]
    fn acks_are_one_message_per_interval_with_the_count_bytes_and_mean_udp_time() {
        let start = Instant::now();
        let mut acks = Acks::default();
        assert_eq!((acks.due(), acks.take()), (None, None));
        acks.add(start, 5, 1.0, 100);
        acks.add(start + Duration::from_millis(40), 6, 3.0, 300);
        acks.add(start + Duration::from_millis(90), 7, 2.0, 200);
        assert_eq!(acks.due(), Some(start + Acks::INTERVAL));
        assert_eq!(
            acks.take(),
            Some(Message::Ack {
                frame_id: 7,
                count: 3,
                udp_ms: 2.0,
                bytes: 600
            })
        );
        assert_eq!((acks.due(), acks.take()), (None, None));
        let later = start + Duration::from_secs(1);
        acks.add(later, 8, 0.5, 30);
        assert_eq!(acks.due(), Some(later + Acks::INTERVAL));
    }

    #[test]
    fn frames_pushed_out_of_the_queue_are_dropped_one_message_each_and_the_rest_acked_in_a_batch() {
        let (connection, messages) = connect(9);
        let blocked = connection.0.target.lock().unwrap();
        for id in 1..=5 {
            connection.send_frame(frame(id, &[1, 2, 3]));
        }
        // the UDP thread takes at most one frame before it waits on the target, so at least two of frames 1 to 3 were pushed out
        let mut dropped = Vec::new();
        while let Ok(Message::Drop { frame_id }) = messages.try_recv() {
            dropped.push(frame_id);
        }
        assert!(
            dropped.len() >= 2 && dropped.iter().all(|id| (1..=3).contains(id)),
            "{dropped:?}"
        );
        drop(blocked);

        let mut acked = 0;
        while acked + dropped.len() < 5 {
            match messages
                .recv_timeout(Duration::from_secs(5))
                .expect("no ack")
            {
                Message::Ack {
                    frame_id,
                    count,
                    bytes,
                    ..
                } => {
                    acked += count as usize;
                    assert_eq!(bytes, 0);
                    if acked + dropped.len() == 5 {
                        assert_eq!(frame_id, 5);
                    }
                }
                other => panic!("unexpected {other:?}"),
            }
        }
        assert_eq!(acked + dropped.len(), 5);
    }

    #[test]
    fn osc_messages_reach_the_page_until_the_port_is_turned_off() {
        let (connection, messages) = connect(9);
        let port = device().1;
        connection.configure(Config {
            osc_port: Some(port.into()),
            ..Config::default()
        });
        let listening = Message::Log {
            level: Level::Info,
            msg: format!("Listening for OSC on UDP {port}"),
        };
        assert!((0..2).any(|_| messages.recv_timeout(Duration::from_secs(5)).unwrap() == listening));

        let sender = UdpSocket::bind("127.0.0.1:0").unwrap();
        sender
            .send_to(b"/fader\0\0,f\0\0\x3f\0\0\0", ("127.0.0.1", port))
            .unwrap();
        // the config thread's "No host configured" warning can still be queued behind "Listening"
        let received =
            std::iter::repeat_with(|| messages.recv_timeout(Duration::from_secs(5)).unwrap())
                .find(|message| !matches!(message, Message::Log { .. }))
                .unwrap();
        assert_eq!(
            serde_json::to_string(&received).unwrap(),
            r#"{"type":"osc","address":"/fader","args":[0.5]}"#
        );
    }

    #[test]
    fn messages_are_the_json_the_page_already_reads() {
        let json = |message: Message| serde_json::to_string(&message).unwrap();
        assert_eq!(
            json(Message::Ack {
                frame_id: 7,
                count: 3,
                udp_ms: 0.5,
                bytes: 30
            }),
            r#"{"type":"ack","frameId":7,"count":3,"udpMs":0.5,"bytes":30}"#
        );
        assert_eq!(
            json(Message::Drop { frame_id: 8 }),
            r#"{"type":"drop","frameId":8}"#
        );
        assert_eq!(
            json(Message::Log {
                level: Level::Warn,
                msg: "m".into()
            }),
            r#"{"type":"log","level":"warn","msg":"m"}"#
        );
        assert_eq!(
            json(Message::Device {
                name: "n".into(),
                version: "0.15".into(),
                led_count: 60
            }),
            r#"{"type":"device","name":"n","version":"0.15","ledCount":60}"#
        );
        assert_eq!(
            json(Message::Ping {
                ms: Some(3.0),
                fps: Some(40.0)
            }),
            r#"{"type":"ping","ms":3.0,"fps":40.0}"#
        );
        assert_eq!(
            json(Message::Ping {
                ms: None,
                fps: None
            }),
            r#"{"type":"ping","ms":null}"#
        );
    }

    #[test]
    fn a_config_from_the_page_tolerates_missing_and_null_numbers() {
        let config: Config = serde_json::from_str(
            r#"{"type":"config","host":"h","protocol":"sacn","universe":null,"oscPort":9000}"#,
        )
        .unwrap();
        assert_eq!(
            (config.host.as_str(), config.universe, config.osc_port),
            ("h", None, Some(9000.0))
        );
    }
}
