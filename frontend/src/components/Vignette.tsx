import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet } from "react-native";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";

/**
 * Red edge glow for the camera screen. Fades in when `active` turns on, breathes gently while it stays on,
 * and fades out when it turns off. Clear in the middle so it never covers what you're looking at.
 */
export function Vignette({
  active,
  color = "#B71947",
}: {
  active: boolean;
  color?: string;
}) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    opacity.stopAnimation();
    if (!active) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 450,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
      return;
    }
    // Fade in, then pulse between 100% and 55% until the camera leaves the view.
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.55,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    const run = Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 450,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      pulse,
    ]);
    run.start();
    return () => run.stop();
  }, [active, opacity]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { opacity }]}
    >
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient
            id="vignette"
            cx="50%"
            cy="50%"
            rx="75%"
            ry="65%"
            fx="50%"
            fy="50%"
          >
            <Stop offset="0.55" stopColor={color} stopOpacity={0} />
            <Stop offset="0.8" stopColor={color} stopOpacity={0.35} />
            <Stop offset="1" stopColor={color} stopOpacity={0.8} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#vignette)" />
      </Svg>
    </Animated.View>
  );
}
