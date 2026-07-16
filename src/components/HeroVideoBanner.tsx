import { useRef, useCallback } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import { useIsFocused, useFocusEffect } from '@react-navigation/native';
import { HOMEPAGE_HERO_LECTURE } from '../lib/homepageHeroLecture';

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_H_MARGIN = 16; // horizontal margin on each side
const CARD_W = SCREEN_W - CARD_H_MARGIN * 2;
const CARD_H = Math.round((CARD_W * 9) / 16); // strict 16:9

export default function HeroVideoBanner() {
  const videoRef = useRef<Video>(null);
  const isFocused = useIsFocused();

  // Pause when screen loses focus; resume when it regains focus.
  // This also satisfies the "release when not visible" requirement —
  // pausing (vs unloading) keeps the surface alive so no setSurface/Released
  // crash on Android when the screen comes back.
  useFocusEffect(
    useCallback(() => {
      // Resume playback when screen comes into focus
      if (videoRef.current) {
        videoRef.current.playAsync().catch(() => {
          // video may not be loaded yet — shouldPlay handles initial autoplay
        });
      }

      return () => {
        // Pause (not unload) on blur — keeps the Android surface alive
        // to avoid the setSurface/Released crash on return
        if (videoRef.current) {
          videoRef.current.pauseAsync().catch(() => {});
        }
      };
    }, [])
  );

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Video
          ref={videoRef}
          source={{ uri: HOMEPAGE_HERO_LECTURE.videoMp4Url }}
          style={styles.video}
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay={isFocused}
          isMuted
          isLooping
          useNativeControls
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SCREEN_W,
    alignItems: 'center',
    marginTop: 32,
    marginBottom: 24,
    // Bring the shadow into view on Android
    paddingHorizontal: CARD_H_MARGIN,
  },
  card: {
    width: CARD_W,
    height: CARD_H,
    minHeight: 270,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 4,
    borderColor: 'rgba(255,255,255,0.2)',
    // Android shadow
    elevation: 8,
    // iOS shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
  },
  video: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
});
