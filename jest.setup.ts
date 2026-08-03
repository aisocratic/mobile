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

// Metro injects these at build time; jest doesn't.
process.env.EXPO_PUBLIC_API_URL ||= "https://api.example.test"
process.env.EXPO_PUBLIC_API_KEY ||= "test-anon-key"
