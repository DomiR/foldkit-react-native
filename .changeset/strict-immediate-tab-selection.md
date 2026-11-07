---
'foldkit': minor
---

Strict tabs accept `ImmediateTabSelection(true)`. On native, the tab bar then switches as soon as the user taps a tab and reports the tap through `OnSelectTab`, instead of waiting for update. Update must select the reported tab; to reject tab changes, keep the default, where the tab bar follows the Model. The web ignores it.
