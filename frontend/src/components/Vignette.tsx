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
    let cancelled = false;
    let pulse: Animated.CompositeAnimation | null = null;

    // Not native-driven on purpose: a native loop leaves the JS-side value stale,
    // so an interrupting fade-out computes its start frame from the wrong value and
    // snaps straight to 0. On the JS driver the value stays in sync every frame, so
    // the fade-out always eases from the glow's real current opacity.
    opacity.stopAnimation();

    if (!active) {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 450,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start();
    } else {
      // Fade in, then pulse between 100% and 55% until the camera leaves the view.
      Animated.timing(opacity, {
        toValue: 1,
        duration: 450,
        easing: Easing.out(Easing.quad),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (!finished || cancelled) return;
        pulse = Animated.loop(
          Animated.sequence([
            Animated.timing(opacity, {
              toValue: 0.55,
              duration: 900,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: false,
            }),
            Animated.timing(opacity, {
              toValue: 1,
              duration: 900,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: false,
            }),
          ]),
        );
        pulse.start();
      });
    }

    return () => {
      cancelled = true;
      pulse?.stop();
    };
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
