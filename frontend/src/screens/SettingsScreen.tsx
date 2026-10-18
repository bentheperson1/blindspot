import { useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View, FlatList} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RadiusSlider } from '../components/RadiusSlider';
import { useSettings } from '../settings';
import { BORDER, fonts, radii, useColors, useThemedStyles, type Palette } from '../theme';

/** The Settings tab. A plain list of labeled groups; changes save as soon as you make them. */
export function SettingsScreen({ bottomInset }: { bottomInset: number }) {
  const s = useSettings();
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  const [url, setUrl] = useState(s.apiUrl);
  const scrollRef = useRef<ScrollView>(null);

  // The server address is the last field, so when its keyboard opens, scroll to the bottom
  // (after the keyboard has finished appearing) so the field sits right above the keyboard.
  const revealInput = () => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      sub.remove();
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    setTimeout(() => {
      sub.remove();
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 400);
  };


  return (
    <View style={styles.screen}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">
              Settings
            </Text>
          </View>

          {/* Shrinks the scroll area by however much the keyboard covers, on iPhone and Android. */}
          <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[styles.body, { paddingBottom: bottomInset + 24 }]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <Group label="Appearance">
              <Choice
                options={[
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'system', label: 'Match phone' },
                ]}
                value={s.appearance}
                onChange={(appearance) => s.update({ appearance })}
              />
            </Group>

            <Group>
              <RadiusSlider />
            </Group>

            <Group label="Getting around" note="">
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

            <Group label="Server address" note="Change this if you're hosting your own server.">
              <TextInput
                style={styles.input}
                value={url}
                onChangeText={(t) => {
                  setUrl(t);
                  s.update({ apiUrl: t.trim() });
                }}
                onFocus={revealInput}
                onEndEditing={() => s.update({ apiUrl: url.trim() })}
                returnKeyType="done"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="http://192.168.1.20:8000"
                placeholderTextColor={colors.onSurfaceVariant}
                accessibilityLabel="Server address"
              />
            </Group>
          </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
    </View>
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
    screen: { flex: 1, backgroundColor: c.surface },
    header: {
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
      borderBottomWidth: BORDER,
      borderBottomColor: c.outlineVariant,
    },
    title: { fontFamily: fonts.heading, fontSize: 24, color: c.onSurface },
    body: { padding: 16, gap: 20 },
    group: { gap: 6 },
    groupLabel: { fontFamily: fonts.sansBold, fontSize: 12, letterSpacing: 0.6, color: c.primary, textTransform: 'uppercase' },
    card: {
      backgroundColor: c.surfaceContainerLow,
      borderRadius: radii.card,
      padding: 12,
      borderWidth: BORDER,
      borderColor: c.outlineVariant,
    },
    note: { fontFamily: fonts.sans, fontSize: 13, color: c.onSurfaceVariant, lineHeight: 18 },
    choice: { flexDirection: 'row', gap: 8 },
    choiceItem: {
      flex: 1,
      height: 46,
      paddingHorizontal: 6,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radii.icon,
      borderWidth: BORDER,
      borderColor: c.outline,
      backgroundColor: 'transparent',
    },
    choiceOn: { backgroundColor: c.secondaryContainer, borderColor: c.outline },
    choiceText: { fontFamily: fonts.sansSemi, fontSize: 14, color: c.onSurface },
    choiceTextOn: { fontFamily: fonts.sansBold, color: c.onSecondaryContainer },
    input: {
      backgroundColor: 'transparent',
      color: c.onSurface,
      fontFamily: fonts.sans,
      borderRadius: radii.icon,
      paddingHorizontal: 12,
      paddingVertical: 12,
      fontSize: 15,
      borderWidth: BORDER,
      borderColor: c.outline,
    },
  });
