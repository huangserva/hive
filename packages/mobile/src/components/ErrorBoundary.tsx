import { Component, type ErrorInfo, type PropsWithChildren, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[HippoTeam mobile] app error', error, errorInfo)
  }

  retry = () => {
    this.setState({ error: null })
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            The mobile app hit an unexpected error. Retry the screen, or restart the app if it keeps
            happening.
          </Text>
          <Pressable accessibilityRole="button" onPress={this.retry} style={styles.button}>
            <Text style={styles.buttonText}>Retry</Text>
          </Pressable>
        </View>
      )
    }
    return this.props.children
  }
}

export const OfflineBanner = () => {
  const [offline, setOffline] = useState(
    typeof navigator !== 'undefined' && 'onLine' in navigator ? navigator.onLine === false : false
  )

  useEffect(() => {
    const eventTarget =
      typeof globalThis.addEventListener === 'function' &&
      typeof globalThis.removeEventListener === 'function'
        ? globalThis
        : null
    if (!eventTarget) return undefined
    const markOnline = () => setOffline(false)
    const markOffline = () => setOffline(true)
    eventTarget.addEventListener('online', markOnline)
    eventTarget.addEventListener('offline', markOffline)
    return () => {
      eventTarget.removeEventListener('online', markOnline)
      eventTarget.removeEventListener('offline', markOffline)
    }
  }, [])

  if (!offline) return null
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>Offline. Showing the last loaded state.</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#8A5A00',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  bannerText: {
    color: '#FFF4D6',
    fontSize: 13,
    fontWeight: '700',
  },
  button: {
    backgroundColor: '#58A6FF',
    borderRadius: 10,
    marginTop: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  buttonText: {
    color: '#06101F',
    fontSize: 15,
    fontWeight: '800',
  },
  fallback: {
    alignItems: 'center',
    backgroundColor: '#0D1117',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  message: {
    color: '#8B949E',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 12,
    maxWidth: 320,
    textAlign: 'center',
  },
  title: {
    color: '#F0F6FC',
    fontSize: 22,
    fontWeight: '800',
  },
})
