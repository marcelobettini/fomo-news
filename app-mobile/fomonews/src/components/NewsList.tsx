import { FlatList, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { NewsItem } from '../api/types';

interface Props {
  news: NewsItem[];
  refreshing: boolean;
  onRefresh: () => void;
}

export function NewsList({ news, refreshing, onRefresh }: Props) {
  return (
    <FlatList
      data={news}
      keyExtractor={(item) => item.link}
      refreshing={refreshing}
      onRefresh={onRefresh}
      contentContainerStyle={news.length === 0 ? styles.emptyContainer : styles.list}
      ListEmptyComponent={
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No hay noticias hoy</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity style={styles.card} onPress={() => Linking.openURL(item.link)}>
          <Text style={styles.title}>{item.title}</Text>
          <Text style={styles.summary}>{item.summary}</Text>
          <Text style={styles.date}>{new Date(item.publishedAt).toLocaleDateString()}</Text>
        </TouchableOpacity>
      )}
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: 16 },
  emptyContainer: { flexGrow: 1, justifyContent: 'center', alignItems: 'center' },
  centered: { alignItems: 'center', padding: 24 },
  emptyText: { fontSize: 16, color: '#666' },
  card: { backgroundColor: '#f7f7f7', borderRadius: 8, padding: 12, marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '600', marginBottom: 4 },
  summary: { fontSize: 14, color: '#333', marginBottom: 6 },
  date: { fontSize: 12, color: '#888' },
});
