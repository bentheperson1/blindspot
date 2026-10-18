import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  Polygon,
  Rect,
  Stop,
} from "react-native-svg";

/**
 * ~1.7 s intro built from the logo's own pieces (drawn in a 1000×1000 box, same layout as assets/logo.png):
 *   pole rises → camera head slides in → red light blinks → beam sweeps out → "blindspot" fades up → fade to the app.
 * Calls `onPlayed` when the logo is complete (the app can mount underneath), then fades out once `appReady`
 * is true and calls `onDone`.
 */
const BG = "#151627";
const CREAM = "#ECEAE4";
const RED = "#B71947";
const RING = "#3F426D";

export function StartupAnimation({
  appReady,
  fontsLoaded,
  onPlayed,
  onDone,
}: {
  appReady: boolean;
  fontsLoaded: boolean;
  onPlayed: () => void;
  onDone: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const S = Math.min(width, height); // logo square size

  const pole = useRef(new Animated.Value(0)).current;
  const head = useRef(new Animated.Value(0)).current;
  const light = useRef(new Animated.Value(0)).current;
  const beam = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const screen = useRef(new Animated.Value(1)).current;
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);
    const anim = Animated.sequence([
      Animated.parallel([
        Animated.timing(pole, {
          toValue: 1,
          duration: 420,
          easing: ease,
          useNativeDriver: true,
        }),
        Animated.timing(head, {
          toValue: 1,
          duration: 480,
          easing: ease,
          useNativeDriver: true,
        }),
      ]),
      // red light: blink, blink, on
      Animated.sequence([
        Animated.timing(light, {
          toValue: 1,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(light, {
          toValue: 0.15,
          duration: 90,
          useNativeDriver: true,
        }),
        Animated.timing(light, {
          toValue: 1,
          duration: 90,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(beam, {
          toValue: 1,
          duration: 420,
          easing: ease,
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.delay(180),
          Animated.timing(word, {
            toValue: 1,
            duration: 360,
            easing: ease,
            useNativeDriver: true,
          }),
        ]),
      ]),
      Animated.delay(220),
    ]);
    anim.start(({ finished }) => {
      if (finished) {
        setPlayed(true);
        onPlayed();
      }
    });
    return () => anim.stop();
  }, []);

  // Fade the whole intro away once it has played and the app is ready underneath.
  useEffect(() => {
    if (!played || !appReady) return;
    Animated.timing(screen, {
      toValue: 0,
      duration: 320,
      easing: Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) onDone();
    });
  }, [played, appReady]);

  // Beam grows out of the camera lens: scaleX around the lens (x = 0.29 of the box).
  const pivot = 0.29 * S;
  const beamScale = beam.interpolate({
    inputRange: [0, 1],
    outputRange: [0.02, 1],
  });

  const layer = {
    position: "absolute" as const,
    left: 0,
    top: 0,
    width: S,
    height: S,
  };

  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.bg, { opacity: screen }]}
      pointerEvents="none"
      accessible
      accessibilityLabel="blindspot"
    >
      <View style={{ width: S, height: S }}>
        {/* Beam (behind the camera) */}
        <Animated.View
          style={[
            layer,
            {
              opacity: beam,
              transform: [
                { translateX: pivot - S / 2 },
                { scaleX: beamScale },
                { translateX: S / 2 - pivot },
              ],
            },
          ]}
        >
          <Svg viewBox="0 0 1000 1000" width={S} height={S}>
            <Defs>
              <LinearGradient id="beam" x1="0.28" y1="0.25" x2="0.68" y2="0.75">
                <Stop offset="0" stopColor={RED} stopOpacity={0.85} />
                <Stop offset="1" stopColor={RED} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Polygon
              points="300,240 1000,650 1000,760 700,940 270,290"
              fill="url(#beam)"
            />
          </Svg>
        </Animated.View>

        {/* Pole: rises from below */}
        <Animated.View
          style={[
            layer,
            {
              transform: [
                {
                  translateY: pole.interpolate({
                    inputRange: [0, 1],
                    outputRange: [S * 0.75, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Svg viewBox="0 0 1000 1000" width={S} height={S}>
            <Rect
              x="78"
              y="300"
              width="38"
              height="720"
              fill={CREAM}
              stroke={RED}
              strokeWidth="8"
            />
          </Svg>
        </Animated.View>

        {/* Camera head: slides in from the left */}
        <Animated.View
          style={[
            layer,
            {
              transform: [
                {
                  translateX: head.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-S * 0.5, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Svg viewBox="0 0 1000 1000" width={S} height={S}>
            <Path
              d="M -30 65 H 195 A 123 123 0 0 1 195 311 H -30 Z"
              fill={CREAM}
              stroke={RED}
              strokeWidth="8"
            />
            <Circle
              cx="221"
              cy="189"
              r="50"
              fill={BG}
              stroke={RING}
              strokeWidth="13"
            />
          </Svg>
          {/* Red status light (its own layer so it can blink) */}
          <Animated.View style={[layer, { opacity: light }]}>
            <Svg viewBox="0 0 1000 1000" width={S} height={S}>
              <Circle cx="153" cy="134" r="13" fill={RED} />
            </Svg>
          </Animated.View>
        </Animated.View>

        {/* Wordmark: fades up */}
        <Animated.View
          style={{
            position: "absolute",
            left: 0.25 * S,
            top: 0.53 * S,
            opacity: word,
            transform: [
              {
                translateY: word.interpolate({
                  inputRange: [0, 1],
                  outputRange: [S * 0.03, 0],
                }),
              },
            ],
          }}
        >
          <Text
            style={{
              color: CREAM,
              fontSize: 0.143 * S,
              letterSpacing: -0.004 * S,
              ...(fontsLoaded
                ? { fontFamily: "Archivo_800ExtraBold" }
                : { fontWeight: "800" }),
            }}
            allowFontScaling={false}
          >
            blindspot
          </Text>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bg: {
    backgroundColor: BG,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
});
