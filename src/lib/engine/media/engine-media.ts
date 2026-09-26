import { ref } from 'vue'
import { log, report } from '@/lib/app/logs'
import type { AudioService } from '@/lib/audio/service'
import { checkTrackFile } from '@/lib/audio/track-file'
import { Format } from '@/lib/util/format'
import { EngineError } from '@/lib/engine/engine-error'
import type { ImageLibrary } from './images'
import { loadMedia, saveMedia, clearMedia, type MediaKey } from './media-store'
import type { ShaderRenderer } from '@/lib/engine/render/renderer'

type MediaFile = { blob: Blob; name: string }

/** The song and pictures the engine plays and shows: the user's own, remembered between visits, or the built-in ones. */
export class EngineMedia {
  /** Name of the image the shader samples, for the UI. */
  readonly imageName = ref('Built-in image')
  /** What happened to the last track the user picked, for the places that offer the choice. */
  readonly trackStatus = ref<{ level: 'info' | 'error'; message: string } | null>(null)
  // library ids per layer of the renderer's image array, as last uploaded
  private imageLayers: string[] = []

  constructor(private readonly audio: AudioService, private readonly images: ImageLibrary, private readonly renderer: () => ShaderRenderer | null) {}

  /** Shows the built-in image, then the user's own song and image from an earlier visit, when there are any. */
  restore() {
    this.showImage('/assets/image.jpg')
    void loadMedia('image').then((stored) => stored && this.useImage(stored, false)).catch((cause) => report(new EngineError('media-store', 'Your image from the last visit could not be loaded', cause)))
    void loadMedia('song').then((stored) => stored && this.useSong(stored, false)).catch((cause) => report(new EngineError('media-store', 'Your song from the last visit could not be loaded', cause)))
  }

  /** Uses this picture as the image texture and remembers it for the next visit; null restores the built-in one. */
  async useImage(file: MediaFile | null, remember = true) {
    const url = file ? URL.createObjectURL(file.blob) : '/assets/image.jpg'
    this.showImage(url, () => file && URL.revokeObjectURL(url))
    this.imageName.value = file?.name ?? 'Built-in image'
    if (remember) await this.remember('image', file)
  }

  /** Plays this song as the audio file source and, with `remember`, keeps it for the next launch; null restores the built-in track. False when the file is not playable audio. */
  async useSong(file: MediaFile | null, remember = true): Promise<boolean> {
    if (file && remember) {
      const check = await checkTrackFile(file)
      if (!check.ok) {
        this.trackStatus.value = { level: 'error', message: `${check.reason} The track was not changed.` }
        log(check.reason, 'error')
        return false
      }
      await this.audio.setFile(file)
      await this.remember('song', file)
      const playing = this.audio.state.playing && this.audio.state.settings.source === 'file'
      this.trackStatus.value = { level: 'info', message: `${file.name} (${Format.duration(check.seconds)}) is the default track now and at every launch. ${playing ? 'It is playing.' : 'It starts when you press Play.'}` }
      return true
    }
    await this.audio.setFile(file)
    if (remember) {
      await this.remember('song', file)
      this.trackStatus.value = { level: 'info', message: 'Back to the built-in track, now and at every launch.' }
    }
    return true
  }

  /** Decodes the images a graph's Image Texture nodes picked into the renderer's layers; only layers that changed are redone. */
  async showImages(ids: string[]) {
    await this.images.ready
    ids.forEach((id, layer) => {
      if (this.imageLayers[layer] === id) return
      const image = this.images.get(id)
      if (!image) return log(`Image "${id}" is not in the library any more; open it again on its node`, 'warn')
      this.imageLayers[layer] = id
      const element = new Image()
      element.onload = () => this.imageLayers[layer] === id && this.renderer()?.setImageLayer(layer, element)
      element.onerror = () => log(`${image.name} could not be read as an image`, 'error')
      element.src = image.url
    })
  }

  private async remember(key: MediaKey, file: MediaFile | null) {
    try {
      await (file ? saveMedia(key, file) : clearMedia(key))
    } catch (e) {
      log(`Could not keep the ${key} for next time: ${(e as Error).message}`, 'warn')
    }
  }

  private showImage(url: string, done?: () => void) {
    const img = new Image()
    img.onload = () => {
      this.renderer()?.setImage(img)
      log(`Image texture loaded (${img.width}x${img.height})`)
      done?.()
    }
    img.onerror = () => {
      log('That file could not be read as an image', 'error')
      done?.()
    }
    img.src = url
  }
}
