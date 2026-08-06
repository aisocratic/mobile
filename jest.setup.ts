// expo-secure-store has no JS implementation under jest; the session storage
// adapter in src/lib/supabase.ts only needs it to exist.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

// Same story for AsyncStorage: importing it outside a native runtime throws
// ("NativeModule: AsyncStorage is null"), which takes down any suite that
// transitively reaches src/lib/supabase.ts. The package ships its own
// in-memory jest mock for exactly this.
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
)

// @expo/vector-icons reaches expo-font, which requires expo-asset without
// declaring it — npm installs that copy nested under node_modules/expo, where
// jest's resolver won't look (Metro finds it, so this is a test-only failure).
// Every icon in the app is decorative and sits inside an element that already
// carries its own accessibility label, so nothing is lost by standing Ionicons
// up as an empty view; `name`/`size`/`color` are dropped rather than forwarded
// to keep them off the host component. Ionicons is the only set the app
// imports — add others here if that changes.
jest.mock("@expo/vector-icons", () => {
  const React = require("react")
  const { View } = require("react-native")
  return {
    Ionicons: ({ name, size, color, ...rest }: Record<string, unknown>) =>
      React.createElement(View, rest),
  }
})

// expo-video's player is a native object jest can't construct. The stand-in is
// a small stateful fake: components can set flags and call play/pause on it,
// and every player ever created is recorded on `__videoPlayers` so tests can
// assert what playback was actually asked for. Recreating the player when
// `source` changes (and re-running `setup`) mirrors the real hook.
jest.mock("expo-video", () => {
  const React = require("react")
  const { View } = require("react-native")

  type MockPlayer = {
    source: unknown
    loop: boolean
    muted: boolean
    playing: boolean
    audioMixingMode: string
    play: jest.Mock
    pause: jest.Mock
    replace: jest.Mock
    addListener: jest.Mock
  }

  const players: MockPlayer[] = []

  const makePlayer = (source: unknown): MockPlayer => {
    const player = {
      source,
      loop: false,
      muted: false,
      playing: false,
      audioMixingMode: "auto",
    } as MockPlayer
    player.play = jest.fn(() => {
      player.playing = true
    })
    player.pause = jest.fn(() => {
      player.playing = false
    })
    player.replace = jest.fn()
    player.addListener = jest.fn(() => ({ remove: jest.fn() }))
    players.push(player)
    return player
  }

  return {
    VideoView: ({
      player,
      nativeControls,
      contentFit,
      fullscreenOptions,
      allowsPictureInPicture,
      ...rest
    }: Record<string, unknown>) => React.createElement(View, rest),
    useVideoPlayer: (source: unknown, setup?: (p: MockPlayer) => void) => {
      const ref = React.useRef(null) as { current: { source: unknown; player: MockPlayer } | null }
      if (!ref.current || ref.current.source !== source) {
        const player = makePlayer(source)
        ref.current = { source, player }
        setup?.(player)
      }
      return ref.current.player
    },
    __videoPlayers: players,
  }
})

// Metro injects these at build time; jest doesn't.
process.env.EXPO_PUBLIC_API_URL ||= "https://api.example.test"
process.env.EXPO_PUBLIC_API_KEY ||= "test-anon-key"
