import { MAX_IMAGE_BYTES } from './data'

/** Inspect image bytes because some devices label JPGs as image/jpg or omit their MIME type. */
export async function readExerciseImage(file: File): Promise<string> {
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new Error('Invalid image size.')
  }
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((value, index) => bytes[offset + index] === value)
  const type = startsWith([0xff, 0xd8, 0xff])
    ? 'image/jpeg'
    : startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ? 'image/png'
      : startsWith([0x47, 0x49, 0x46, 0x38]) &&
          (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
        ? 'image/gif'
        : startsWith([0x52, 0x49, 0x46, 0x46]) &&
            startsWith([0x57, 0x45, 0x42, 0x50], 8)
          ? 'image/webp'
          : null
  if (!type) throw new Error('Unsupported image format.')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.onabort = () => reject(new Error('Image reading was interrupted.'))
    reader.readAsDataURL(new Blob([file], { type }))
  })
  const image = new Image()
  image.src = data
  await image.decode()
  return data
}
