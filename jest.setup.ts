// expo-secure-store has no JS implementation under jest; the session storage
// adapter in src/lib/supabase.ts only needs it to exist.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}))

// Metro injects these at build time; jest doesn't.
process.env.EXPO_PUBLIC_API_URL ||= "https://api.example.test"
process.env.EXPO_PUBLIC_API_KEY ||= "test-anon-key"
