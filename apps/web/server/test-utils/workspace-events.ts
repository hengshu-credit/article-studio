/** Read data-bearing frames from the workspace SSE endpoint across arbitrary network chunks. */
export function createEventReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const decoder = new TextDecoder()
  let buffer = ''
  return async () => {
    for (;;) {
      const end = buffer.indexOf('\n\n')
      if (end < 0) {
        const chunk = await reader.read()
        if (chunk.done)
          throw new Error('Workspace event stream ended before the next event')
        buffer += decoder.decode(chunk.value, { stream: true })
        continue
      }

      const lines = buffer.slice(0, end).split('\n')
      buffer = buffer.slice(end + 2)
      const data = lines.filter(line => line.startsWith('data: '))
      if (data.length) {
        return {
          event: lines.find(line => line.startsWith('event: '))?.slice(7) ?? 'message',
          data: data.map(line => line.slice(6)).join('\n'),
        }
      }
    }
  }
}
