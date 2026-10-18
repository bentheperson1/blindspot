import { Feather } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BORDER, fonts, radii, useColors, useThemedStyles, type Palette } from '../theme';

const FAQS: { q: string; a: string }[] = [
  {
    q: 'What is a Flock camera?',
    a: 'Flock Safety makes automated license plate reader (ALPR) cameras. They are usually mounted on a pole by the road and photograph passing cars and their plates.',
  },
  {
    q: 'What does Blind Spot do?',
    a: 'It shows known Flock cameras around you. The Map tab lists the ones inside your search radius, and the Camera tab marks them on the live camera view so you can see where they point.',
  },
  {
    q: 'How do I report a camera?',
    a: 'Open the Report tab, line up the camera and take a photo. The server checks the photo and tells you whether it looks like a Flock camera. If it says it isn\'t sure, move closer and try again.',
  },
  {
    q: 'What does my phone send to the server?',
    a: 'The Map and Camera tabs send your location, compass heading and phone orientation so the server can find cameras near you and place them on screen. The Report tab sends the photo you take.',
  },
  {
    q: 'Why don\'t the markers line up in the Camera tab?',
    a: 'The compass probably needs calibrating. Move the phone in a figure-8 a few times. Metal and magnets nearby can also throw it off.',
  },
  {
    q: 'Why does it say it can\'t reach the server?',
    a: 'Check the server address in Settings. Your phone has to be able to reach that address, for example on the same Wi-Fi network as the server.',
  },
  {
    q: 'How do I change the search radius or units?',
    a: 'Use the radius slider on the Map tab or in Settings. Settings also switches between miles and kilometers, and between walking and driving.',
  },
];

const CREDITS = [
  { name: 'Preston Crow', role: 'Backend developer' },
  { name: 'Amna Ashraf', role: 'Data scientist' },
  { name: 'Adya D', role: 'Frontend developer' },
  { name: 'Ben Holland', role: 'Backend developer' },
  { name: 'Jacob', role: 'Data scientist' },
];

/** The FAQ tab: common questions (tap to expand), then the team credits. */
export function FaqScreen({ bottomInset }: { bottomInset: number }) {
  const styles = useThemedStyles(makeStyles);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <View style={styles.screen}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <View style={styles.header}>
          <Text style={styles.title} accessibilityRole="header">
            FAQ
          </Text>
        </View>

        <ScrollView contentContainerStyle={[styles.body, { paddingBottom: bottomInset + 24 }]}>
          <View style={styles.group}>
            <Text style={styles.groupLabel}>Frequently asked questions</Text>
            <View style={styles.card}>
              {FAQS.map((item, i) => (
                <FaqItem
                  key={item.q}
                  q={item.q}
                  a={item.a}
                  first={i === 0}
                  expanded={open === i}
                  onToggle={() => setOpen(open === i ? null : i)}
                />
              ))}
            </View>
          </View>

          <View style={styles.group}>
            <Text style={styles.groupLabel}>Credits</Text>
            <View style={[styles.card, styles.credits]}>
              {CREDITS.map((item) => (
                <Text key={item.name}>
                  <Text style={styles.creditName}>{item.name}</Text>
                  <Text style={styles.creditRole}> - {item.role}</Text>
                </Text>
              ))}
            </View>
            <Text style={styles.note}>
              This app was built in 24 hours for the 2026 IBM Z Datathon by a team of students from The
              University of Texas at Dallas.
            </Text>
          </View>

          <View style={styles.group}>
            <Text style={styles.groupLabel}>Legal</Text>
            <Text style={styles.note}>
              This app is not affiliated with or endorsed by Flock Safety, Inc. The Flock Safety brand is a registered trademark of Flock Safety, Inc.
            </Text>
            <Text style={styles.note}>
              For entertainment purposes only. Do not use this app to harass or intimidate anyone, or to violate any laws. The authors are not responsible for any misuse of this app.
            </Text>
          </View>

          <View style={styles.group}>
            <Text style={styles.groupLabel}>Version</Text>
            <Text style={styles.note}>v0.1.0</Text>
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function FaqItem({
  q,
  a,
  first,
  expanded,
  onToggle,
}: {
  q: string;
  a: string;
  first: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const colors = useColors();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={!first && styles.itemDivider}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        style={({ pressed }) => [styles.question, pressed && { backgroundColor: colors.surfaceContainerHighest }]}
      >
        <Text style={styles.questionText}>{q}</Text>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={colors.onSurfaceVariant} />
      </Pressable>
      {expanded && <Text style={styles.answer}>{a}</Text>}
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
      borderWidth: BORDER,
      borderColor: c.outlineVariant,
      overflow: 'hidden',
    },
    itemDivider: { borderTopWidth: BORDER, borderTopColor: c.outlineVariant },
    question: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 12,
      paddingVertical: 14,
    },
    questionText: { flex: 1, fontFamily: fonts.sansBold, fontSize: 15, color: c.onSurface },
    answer: {
      fontFamily: fonts.sans,
      fontSize: 14,
      lineHeight: 20,
      color: c.onSurfaceVariant,
      paddingHorizontal: 12,
      paddingBottom: 14,
    },
    credits: { padding: 12, gap: 12 },
    creditName: { fontFamily: fonts.sansBold, color: c.onSurface },
    creditRole: { fontFamily: fonts.sans, color: c.onSurfaceVariant },
    note: { fontFamily: fonts.sans, fontSize: 13, color: c.onSurfaceVariant, lineHeight: 18 },
  });
