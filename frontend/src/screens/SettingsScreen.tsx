import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RadiusSlider } from '../components/RadiusSlider';
import { useSettings } from '../settings';
import { fonts, radii, useColors, useThemedStyles, type Palette } from '../theme';

export function SettingsScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const s = useSettings();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const [url, setUrl] = useState(s.apiUrl);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.close} accessibilityRole="button" accessibilityLabel="Close settings">
            <Feather name="x" size={20} color={colors.text} />
          </Pressable>
        </View>

        <ScrollView contentContainerStyle={styles.body}>
          <Group label="Appearance">
            <Choice
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
                { value: 'system', label: 'Match phone' },
              ]}
              value={s.appearance}
              onChange={(appearance) => s.update({ appearance })}
            />
          </Group>

          <Group>
            <RadiusSlider />
          </Group>

          <Group label="Getting around" note="Sent to the server with every frame.">
            <Choice
              options={[
                { value: 'pedestrian', label: 'Walking' },
                { value: 'driver', label: 'Driving' },
              ]}
              value={s.mode}
              onChange={(mode) => s.update({ mode })}
            />
          </Group>

          <Group label="Distance units">
            <Choice
              options={[
                { value: 'imperial', label: 'Miles' },
                { value: 'metric', label: 'Kilometers' },
              ]}
              value={s.units}
              onChange={(units) => s.update({ units })}
            />
          </Group>

          <Group label="Server address" note="Where camera frames and sensor data are sent.">
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              onEndEditing={() => s.update({ apiUrl: url.trim() })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.1.20:8000"
              placeholderTextColor={colors.muted}
              accessibilityLabel="Server address"
            />
          </Group>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function Group({ label, note, children }: { label?: string; note?: string; children: React.ReactNode }) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.group}>
      {label && <Text style={styles.groupLabel}>{label}</Text>}
      <View style={styles.card}>{children}</View>
      {note && <Text style={styles.note}>{note}</Text>}
    </View>
  );
}

function Choice<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.choice} accessibilityRole="radiogroup">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            style={[styles.choiceItem, on && styles.choiceOn]}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
          >
            <Text style={[styles.choiceText, on && styles.choiceTextOn]} numberOfLines={1}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: c.bg },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 4,
    },
    title: { fontFamily: fonts.display, fontSize: 34, color: c.text },
    close: {
      width: 40,
      height: 40,
      borderRadius: radii.control,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: { padding: 20, gap: 24 },
    group: { gap: 8 },
    groupLabel: { fontFamily: fonts.caps, fontSize: 17, color: c.text },
    card: { backgroundColor: c.surface, borderRadius: radii.card, padding: 14, borderWidth: 1, borderColor: c.line },
    note: { fontFamily: fonts.sans, fontSize: 13, color: c.muted, lineHeight: 18 },
    choice: { flexDirection: 'row', gap: 8 },
    choiceItem: {
      flex: 1,
      height: 44,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.control,
      borderWidth: 1,
      borderColor: c.line,
    },
    choiceOn: { backgroundColor: c.button, borderColor: c.button },
    choiceText: { fontFamily: fonts.sansSemi, fontSize: 15, color: c.muted },
    choiceTextOn: { color: c.onButton },
    input: {
      backgroundColor: c.bg,
      color: c.text,
      fontFamily: fonts.sans,
      borderRadius: radii.control,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 15,
      borderWidth: 1,
      borderColor: c.line,
    },
  });
