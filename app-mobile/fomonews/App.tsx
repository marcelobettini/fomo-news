import { useCallback, useEffect, useState } from 'react'
import { Alert, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native'
import { NewsList } from './src/components/NewsList'
import { SubscribeForm } from './src/components/SubscribeForm'
import { fetchNews } from './src/api/news'
import type { NewsItem } from './src/api/types'

type ScreenState = { status: 'loading' } | { status: 'error' } | { status: 'loaded'; news: NewsItem[] }

export default function App() {
  const [state, setState] = useState<ScreenState>({ status: 'loading' })
  const [etag, setEtag] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadInitial = useCallback(async () => {
    const result = await fetchNews(null)
    if (result.kind === 'ok') {
      setState({ status: 'loaded', news: result.news })
      setEtag(result.etag)
    } else {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    loadInitial()
  }, [loadInitial])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    const result = await fetchNews(etag)
    setRefreshing(false)

    if (result.kind === 'ok') {
      setState({ status: 'loaded', news: result.news })
      setEtag(result.etag)
    } else if (result.kind === 'unavailable' || result.kind === 'network_error') {
      Alert.alert('No se pudo actualizar', 'Probá de nuevo más tarde.')
    }
  }, [etag])

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <Text style={styles.header}>FOMO-News</Text>
      {state.status === 'loading' && (
        <View style={styles.centered}>
          <Text>Cargando…</Text>
        </View>
      )}
      {state.status === 'error' && (
        <View style={styles.centered}>
          <Text style={styles.errorText}>No se pudieron cargar las noticias. Probá de nuevo más tarde.</Text>
        </View>
      )}
      {state.status === 'loaded' && <NewsList news={state.news} refreshing={refreshing} onRefresh={handleRefresh} />}
      <SubscribeForm />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { fontSize: 20, fontWeight: '700', padding: 16 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { color: '#b00020', textAlign: 'center' },
})
