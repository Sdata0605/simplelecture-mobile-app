// The glowing AI button that floats over the Home screen. It carries the same orb as the Ask AI screen, so the
// student recognises it when they get there. It only reports the tap: the Home screen decides whether that opens
// the AI Teacher (student has a plan) or the plans (they don't).
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { VoiceOrb } from '../askAssistant/VoiceOrb';
import { ask } from '../askAssistant/askTheme';
import { tabBarTop } from '../CustomTabBar';
import { useReduceMotion } from '../../hooks/useReduceMotion';

const HIT = 64; // the tap target
const ORB = 42; // the orb's body; its glow reaches about twice that, past the tap target
const LABEL_DELAY_MS = 1200;
const LABEL_SHOWN_MS = 5500;

interface Props {
  hasActivePlan: boolean;
  onPress: () => void;
}

export function AITeacherFab({ hasActivePlan, onPress }: Props) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const bob = useRef(new Animated.Value(0)).current;
  const label = useRef(new Animated.Value(0)).current;

  // A slow float, so the button reads as alive without being a distraction.
  useEffect(() => {
    if (reduceMotion) {
      bob.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: -4, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [bob, reduceMotion]);

  // The label introduces the button once, then gets out of the way.
  useEffect(() => {
    const intro = Animated.sequence([
      Animated.delay(LABEL_DELAY_MS),
      Animated.timing(label, { toValue: 1, duration: 280, useNativeDriver: true }),
      Animated.delay(LABEL_SHOWN_MS),
      Animated.timing(label, { toValue: 0, duration: 380, useNativeDriver: true }),
    ]);
    intro.start();
    return () => intro.stop();
  }, [label]);

  return (
    <View pointerEvents="box-none" style={[styles.anchor, { bottom: tabBarTop(insets.bottom) + 14 }]}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.label,
          { opacity: label, transform: [{ translateX: label.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] },
        ]}
      >
        <Text style={styles.labelText}>{hasActivePlan ? 'Ask AI Teacher' : 'Meet your AI Teacher'}</Text>
      </Animated.View>

      <Animated.View style={{ transform: [{ translateY: bob }] }}>
        <Pressable
          onPress={onPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={hasActivePlan ? 'Open AI Teacher' : 'See AI Teacher plans'}
          style={({ pressed }) => [styles.hit, pressed && { transform: [{ scale: 0.94 }] }]}
        >
          <View pointerEvents="none" style={styles.face}>
            <VoiceOrb mode="idle" size={ORB} />
            <View style={[StyleSheet.absoluteFill, styles.center]}>
              <Text style={styles.ai}>AI</Text>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export default AITeacherFab;

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    right: 18,
    flexDirection: 'row',
    alignItems: 'center',
  },
  hit: { width: HIT, height: HIT },
  // The orb's layout box is bigger than the tap target; centring lets its glow spill evenly around the button.
  face: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  ai: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.6,
    textShadowColor: 'rgba(3, 7, 30, 0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 4,
  },
  label: {
    marginRight: 2,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: ask.lineStrong,
    backgroundColor: 'rgba(5, 13, 12, 0.94)',
  },
  labelText: { color: ask.mint, fontSize: 12, fontWeight: '700' },
});
