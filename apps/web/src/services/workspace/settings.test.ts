// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { StorageManager } from '@/storage/manager'
import { diffWorkspace, hasChanges } from './model'

afterEach(() => {
  vi.useRealTimers()
  localStorage.clear()
})

describe('shared settings hydration', () => {
  it('undoes an absent setting without inventing a new edit that clears redo', async () => {
    vi.useFakeTimers()
    const store = new StorageManager()
    const themes = store.reactive<Record<string, string>>('themes', {})
    await nextTick()
    themes.value = { installed: 'theme' }
    await nextTick()
    store.applyValues({ themes: null })
    await nextTick()
    await vi.advanceTimersByTimeAsync(300)
    expect(themes.value).toEqual({})
    expect(store.snapshotValues(['themes'])).toEqual({ themes: null })
    const defaultObject = themes.value
    store.applyValues({ themes: null })
    expect(themes.value).toBe(defaultObject)
    // Restoring the setting still works; editing after restore is captured.
    store.applyValues({ themes: '{"installed":"theme"}' })
    expect(themes.value).toEqual({ installed: 'theme' })
    themes.value.installed = 'another'
    expect(store.snapshotValues(['themes']).themes).toBe('{"installed":"another"}')
  })

  it('does not turn lazy store defaults into undo history after joining an older workspace', () => {
    const store = new StorageManager()
    const key = 'MD__marketplace_installed_themes'
    store.applyValues({ [key]: null })
    store.reactive(key, {})
    const changes = diffWorkspace({ posts: [] }, { posts: [], settings: store.snapshotValues([key]) })
    expect(hasChanges(changes)).toBe(false)
  })

  it('initializes a lazy store from the remote value even while the disk write is pending', () => {
    const store = new StorageManager()
    store.setEngine({
      get: async () => null,
      getSync: () => null,
      supportsSyncRead: () => true,
      set: () => new Promise(() => {}),
      remove: async () => {},
      has: async () => false,
      keys: async () => [],
      clear: async () => {},
    })
    store.applyValues({ config: '{ "size": 14 }' })
    const config = store.reactive('config', { size: 16 })
    expect(config.value.size).toBe(14)
    expect(store.snapshotValues(['config']).config).toBe('{ "size": 14 }')
    config.value.size = 18
    expect(store.snapshotValues(['config']).config).toBe('{"size":18}')
  })
})
