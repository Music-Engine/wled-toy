import { isMac, isTauri } from '@/lib/app/platform'
import { systemAudioBlocked } from './settings'

/** A stream from an input device (the default one when `deviceId` is '') or from another tab or the system; `fromClick` says the caller runs inside a click. */
export async function captureAudio(kind: 'device' | 'loopback', deviceId: string, fromClick = false): Promise<MediaStream> {
  if (kind === 'device') {
    return navigator.mediaDevices.getUserMedia({
      // the browser's voice processing would fight the analyzer's own gain control
      audio: { deviceId: deviceId || undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  }
  const blocked = systemAudioBlocked()
  if (blocked) throw new Error(blocked)
  if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') throw new Error(isTauri() ? 'System audio capture is not available in the desktop app on this system.' : 'This browser cannot capture system audio.')
  // a native menu item, a key or a graph that loads is no click for the browser, and Safari forgets a click across an await
  if (!fromClick && navigator.userActivation?.isActive === false) throw new DOMException('getDisplayMedia must be called from a user gesture handler', 'InvalidStateError')
  // Chrome only offers tab or system audio together with a video track; the video is dropped at once
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
  stream.getVideoTracks().forEach((track) => track.stop())
  if (stream.getAudioTracks().length) return stream
  stream.getTracks().forEach((track) => track.stop())
  throw new Error(isMac()
    ? 'No audio was shared. Choose a Chrome Tab and tick Share tab audio; macOS does not share audio for windows or screens.'
    : 'No audio was shared. In the share dialog, tick the option to share tab or system audio.')
}
