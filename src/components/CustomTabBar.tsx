import { useEffect, useRef } from 'react';
import { View, TouchableOpacity, StyleSheet, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../constants/theme';
import { BottomTabBarProps } from '@react-navigation/bottom-tabs';

const NAV_HEIGHT = 50;
const FAB_SIZE = 60;
const FAB_PROTRUDE = 28;

interface BarButtonProps {
  isFocused: boolean;
  iconName: string;
  onPress: () => void;
  onLongPress?: () => void;
  size?: number;
}

function BarButton({ isFocused, iconName, onPress, onLongPress, size = 24 }: BarButtonProps) {
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isFocused) {
      scale.setValue(0);
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        tension: 120,
        friction: 8,
      }).start();
    }
  }, [isFocused, scale]);

  return (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={onPress}
      onLongPress={onLongPress}
      style={styles.tabButton}
    >
      <Animated.View
        style={[
          styles.iconContainer,
          isFocused && styles.iconContainerActive,
          { transform: [{ scale }] },
        ]}
      >
        <Ionicons
          name={iconName as any}
          size={size}
          color={isFocused ? colors.primary : 'rgba(255,255,255,0.6)'}
        />
      </Animated.View>
    </TouchableOpacity>
  );
}

export default function CustomTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const wrapperHeight = NAV_HEIGHT + FAB_PROTRUDE + Math.max(insets.bottom, 6);
  const gradientHeight = NAV_HEIGHT + Math.max(insets.bottom, 6);

  const currentName = state.routes[state.index]?.name;

  const navigateTab = (name: string) => {
    const route = state.routes.find((r) => r.name === name);
    if (!route) return;
    const event = navigation.emit({
      type: 'tabPress',
      target: route.key,
      canPreventDefault: true,
    });
    if (currentName !== name && !event.defaultPrevented) {
      navigation.navigate(name);
    }
  };

  return (
    <View style={[styles.wrapper, { height: wrapperHeight }]}>
      <LinearGradient
        colors={[colors.primary, '#4ADE80', '#22C55E']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={[styles.gradient, { height: gradientHeight }]}
      >
        <View style={styles.tabsRow}>
          <View style={styles.tabsSide}>
            <BarButton
              isFocused={currentName === 'MyCourses'}
              iconName={currentName === 'MyCourses' ? 'book' : 'book-outline'}
              size={22}
              onPress={() => navigateTab('MyCourses')}
            />
            <BarButton
              isFocused={currentName === 'Dashboard'}
              iconName={currentName === 'Dashboard' ? 'grid' : 'grid-outline'}
              size={22}
              onPress={() => navigateTab('Dashboard')}
            />
          </View>

          <View style={styles.centerSpacer} />

          <View style={styles.tabsSide}>
            <BarButton
              isFocused={currentName === 'MyNotes'}
              iconName={currentName === 'MyNotes' ? 'create' : 'create-outline'}
              size={22}
              onPress={() => navigateTab('MyNotes')}
            />
            <BarButton
              isFocused={currentName === 'Reels'}
              iconName={currentName === 'Reels' ? 'play-circle' : 'play-circle-outline'}
              size={24}
              onPress={() => navigateTab('Reels')}
            />
          </View>
        </View>
      </LinearGradient>

      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => navigateTab('Home')}
        style={[styles.fab, styles.fabActive]}
      >
        <LinearGradient
          colors={['#1da85e', '#17954f']}
          style={[styles.fabInner, styles.fabInnerActive]}
        >
          <Ionicons name={'home'} size={28} color="#fff" />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    overflow: 'visible',
  },
  gradient: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 12,
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: NAV_HEIGHT,
    paddingTop: 6,
  },
  tabsSide: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  centerSpacer: {
    width: FAB_SIZE + 16,
  },
  tabButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconContainerActive: {
    backgroundColor: '#fff',
  },
  fab: {
    position: 'absolute',
    top: 0,
    alignSelf: 'center',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 16,
  },
  fabActive: {
    shadowColor: colors.primary,
    shadowOpacity: 0.5,
  },
  fabInner: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fabInnerActive: {
    borderWidth: 3,
    borderColor: '#fff',
  },
});
