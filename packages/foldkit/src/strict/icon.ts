import { Schema } from 'effect'

/** Portable tab icon names. Each host reads only the field it can render and
 * ignores the rest. iOS renders `sfSymbol`, Android renders `materialSymbol`,
 * and the web renders `webGlyph`. A tab with no `TabIcon` attribute shows its
 * title alone on every host.
 * @experimental */
export const StrictIcon = Schema.Struct({
  /** SF Symbol name for the iOS tab, such as `house`. Required. */
  sfSymbol: Schema.String,
  /** SF Symbol name for the selected iOS tab. Missing: `sfSymbol` is used for
   * both states. */
  selectedSfSymbol: Schema.optionalKey(Schema.String),
  /** MaterialIcons glyph name from `@expo/vector-icons` for the Android tab.
   * For example: `grid-view`, `touch-app`, `auto-awesome`. The glyph is
   * rendered at 24px as a tinted image, so the selected state comes from the
   * theme tint rather than a second name. Missing, unknown, or failing to load:
   * the tab shows no icon on Android, and a failed load logs a console warning.
   * The glyph font ships with `@expo/vector-icons`, so Expo Go needs no native
   * assets or rebuild. */
  materialSymbol: Schema.optionalKey(Schema.String),
  /** Text rendered above the tab label on the web, hidden from assistive
   * technology. Missing: the web tab shows its label only. */
  webGlyph: Schema.optionalKey(Schema.String),
})

/** A serializable icon description for strict tabs. @experimental */
export type StrictIcon = typeof StrictIcon.Type
