import { useLayoutEffect } from 'react'

export function useNewLegacyStyles(styles: string[], title: string, bodyClass?: string): void {
  const styleKey = styles.join('|')
  useLayoutEffect(() => {
    const previousTitle = document.title
    document.title = title
    const links = styleKey.split('|').filter(Boolean).map((name) => {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = `/new-legacy/styles/${name}`
      link.dataset.newLegacyRouteStyle = name
      document.head.append(link)
      return link
    })
    if (bodyClass) document.body.classList.add(bodyClass)
    return () => {
      links.forEach((link) => link.remove())
      if (bodyClass) document.body.classList.remove(bodyClass)
      document.title = previousTitle
    }
  }, [bodyClass, styleKey, title])
}
