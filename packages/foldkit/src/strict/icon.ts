import { Schema } from 'effect'

/** Portable tab icon names and an optional text glyph for the web. Native iOS
 * uses SF Symbols. Material symbol names are retained as data; the native Android
 * Tabs API requires drawable or image resources and does not render these names.
 * @experimental */
export const StrictIcon = Schema.Struct({
  sfSymbol: Schema.String,
  selectedSfSymbol: Schema.optionalKey(Schema.String),
  materialSymbol: Schema.optionalKey(Schema.String),
  webGlyph: Schema.optionalKey(Schema.String),
})

/** A serializable icon description for strict tabs. @experimental */
export type StrictIcon = typeof StrictIcon.Type
