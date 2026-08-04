import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { subscribe } from '../api/subscribers';
import { isValidEmailFormat } from '../validation/email';
import { mapSubscribeResultToMessage, SUBSCRIPTION_MESSAGES } from '../validation/subscriptionMessage';

export function SubscribeForm() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!isValidEmailFormat(email)) {
      setMessage(SUBSCRIPTION_MESSAGES.invalidFormat);
      return;
    }

    setSubmitting(true);
    setMessage(null);
    const result = await subscribe(email.trim().toLowerCase());
    setSubmitting(false);
    setMessage(mapSubscribeResultToMessage(result));
    if (result.kind === 'accepted') {
      setEmail('');
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Suscribite para recibir novedades</Text>
      <TextInput
        style={styles.input}
        placeholder="tu@email.com"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        editable={!submitting}
      />
      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={submitting}>
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Suscribirme</Text>}
      </TouchableOpacity>
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, borderTopWidth: 1, borderTopColor: '#eee' },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 8 },
  input: { borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 10, marginBottom: 8 },
  button: { backgroundColor: '#2f6fed', borderRadius: 8, padding: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600' },
  message: { marginTop: 8, fontSize: 13, color: '#333' },
});
