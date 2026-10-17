import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RadiusSlider } from '../components/RadiusSlider';
import { useSettings } from '../settings';
import { colors, radii } from '../theme';

export function SettingsScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useSettings();
  const [url, setUrl] = useState(s.apiUrl);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Section title="View">
            <Segmented
              options={[
                { value: 'map', label: 'Map' },
                { value: 'ar', label: 'AR' },
              ]}
              value={s.view}
              onChange={(view) => s.update({ view })}
            />
          </Section>

          <Section title="Detection">
            <RadiusSlider />
          </Section>

          <Section title="I'm a" note="Sent to the backend with every request.">
            <Segmented
              options={[
                { value: 'pedestrian', label: 'Pedestrian' },
                { value: 'driver', label: 'Driver' },
              ]}
              value={s.mode}
              onChange={(mode) => s.update({ mode })}
            />
          </Section>

          <Section title="Units">
            <Segmented
              options={[
                { value: 'imperial', label: 'Miles' },
                { value: 'metric', label: 'Kilometers' },
              ]}
              value={s.units}
              onChange={(units) => s.update({ units })}
            />
          </Section>

          <Section title="Detector server" note="AR view streams camera frames to this FastAPI server, which runs the detection model.">
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              onEndEditing={() => s.update({ apiUrl: url.trim() })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.1.20:8000"
              placeholderTextColor={colors.textDim}
            />
          </Section>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
      {note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.seg}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable key={o.value} style={[styles.segItem, on && styles.segOn]} onPress={() => onChange(o.value)}>
            <Text style={[styles.segText, on && styles.segTextOn]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  done: { color: colors.accent, fontSize: 16, fontWeight: '700' },
  body: { padding: 20, gap: 22 },
  section: { gap: 8 },
  sectionTitle: { color: colors.textDim, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  card: { backgroundColor: colors.panel, borderRadius: radii.md, padding: 14, gap: 12, borderWidth: 1, borderColor: colors.border },
  note: { color: colors.textDim, fontSize: 12 },
  seg: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: radii.sm, padding: 3 },
  segItem: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: radii.sm - 2 },
  segOn: { backgroundColor: colors.panelRaised },
  segText: { color: colors.textDim, fontWeight: '600', fontSize: 14 },
  segTextOn: { color: colors.text },
  input: {
    backgroundColor: colors.bg,
    color: colors.text,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
