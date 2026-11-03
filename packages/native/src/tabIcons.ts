import MaterialIcons from '@expo/vector-icons/MaterialIcons'
import { Array } from 'effect'
import type { StrictIcon } from 'foldkit/strict'
import * as React from 'react'
import { Platform } from 'react-native'
import type {
  TabsScreenIconAndroid,
  TabsScreenPropsAndroid,
} from 'react-native-screens'

import { collectNativeAttributes } from './builder'
import type { NativeTab } from './node'

type MaterialSymbol = keyof typeof MaterialIcons.glyphMap

const TAB_ICON_SIZE = 24
const TAB_ICON_MASK_COLOR = '#000000'
const iconCache = new Map<
  MaterialSymbol,
  Promise<TabsScreenPropsAndroid | undefined>
>()

const isMaterialSymbol = (name: string): name is MaterialSymbol =>
  Object.hasOwn(MaterialIcons.glyphMap, name)

const loadAndroidTabIcon = (
  name: MaterialSymbol,
): Promise<TabsScreenPropsAndroid | undefined> => {
  const cached = iconCache.get(name)

  if (cached !== undefined) {
    return cached
  }

  const loading = MaterialIcons.getImageSource(
    name,
    TAB_ICON_SIZE,
    TAB_ICON_MASK_COLOR,
  )
    .then(source => {
      if (source === null) {
        iconCache.delete(name)
        return undefined
      }

      const icon: TabsScreenIconAndroid = {
        type: 'imageSource',
        imageSource: source,
        tinting: 'tinted',
      }

      return { icon, selectedIcon: icon }
    })
    .catch(error => {
      iconCache.delete(name)
      console.warn(`Could not render Android tab icon "${name}"`, error)
      return undefined
    })

  iconCache.set(name, loading)
  return loading
}

/** Resolves cached Android tab images with native theme tinting for each state. */
export const useAndroidTabIcons = <Message,>(
  tabs: ReadonlyArray<NativeTab<Message>>,
): ((icon: StrictIcon | undefined) => TabsScreenPropsAndroid | undefined) => {
  const [icons, setIcons] = React.useState<
    ReadonlyMap<MaterialSymbol, TabsScreenPropsAndroid>
  >(() => new Map())

  React.useEffect(() => {
    if (Platform.OS !== 'android') {
      return
    }

    const names = Array.dedupe(
      Array.filter(
        tabs.map(
          tab => collectNativeAttributes(tab.attributes).tabIcon?.materialSymbol,
        ),
        (name): name is MaterialSymbol =>
          name !== undefined && isMaterialSymbol(name),
      ),
    )
    let isMounted = true

    void Promise.all(
      names.map(async name => ({
        name,
        android: await loadAndroidTabIcon(name),
      })),
    ).then(resolvedIcons => {
      if (!isMounted) {
        return
      }

      const nextIcons = new Map<MaterialSymbol, TabsScreenPropsAndroid>()

      for (const { name, android } of resolvedIcons) {
        if (android !== undefined) {
          nextIcons.set(name, android)
        }
      }

      setIcons(nextIcons)
    })

    return () => {
      isMounted = false
    }
  }, [tabs])

  return icon => {
    const name = icon?.materialSymbol

    return name !== undefined && isMaterialSymbol(name)
      ? icons.get(name)
      : undefined
  }
}
