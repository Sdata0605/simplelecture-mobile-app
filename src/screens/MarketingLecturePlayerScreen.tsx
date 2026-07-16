import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, Video, ResizeMode } from 'expo-av';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  fetchV4Presentation,
  resolvePlaybackUrl,
  PlayerLanguage,
  V4Presentation,
} from '../services/v4PlayerService';

/**
 * Marketing Lecture Player — plays a single pre-merged Vimeo progressive MP4.
 *
 * Per the marketing hero playback spec: no V4 section engine, no avatar
 * layers, no subtitles — just a plain native video with native controls,
 * black background, contain fit, a close button and a title bar. The MP4 URL
 * is resolved at open time from the lecture's presentation.json
 * (vimeo_mp4_url / kannada_vimeo_mp4_url), never hardcoded, so it survives
 * Vimeo signature rotation. Progressive MP4 only — no HLS, no proxying,
 * no Vimeo iframe.
 */
export default function MarketingLecturePlayerScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'MarketingLecturePlayer'>>();
  const { jobId, title, subtitle } = route.params;
  const insets = useSafeAreaInsets();

  const videoRef = useRef<Video>(null);
  const [presentation, setPresentation] = useState<V4Presentation | null>(null);
  const [language, setLanguage] = useState<PlayerLanguage>('english');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Same audio mode as the rest of the app so sound plays on iOS silent switch.
  useEffect(() => {
    Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: false,
      shouldDuckAndroid: true,
    }).catch(() => {});
  }, []);

  // Resolve the merged MP4 URL fresh at open time from presentation.json.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const pres = await fetchV4Presentation(jobId);
        if (cancelled) return;
        // Prefer English, fall back to Kannada if that's the only one available.
        const initialLang: PlayerLanguage = resolvePlaybackUrl(pres, 'english')
          ? 'english'
          : 'kannada';
        const url = resolvePlaybackUrl(pres, initialLang);
        if (!url) {
          setError('This video is not available right now. Please try again later.');
          setLoading(false);
          return;
        }
        setPresentation(pres);
        setLanguage(initialLang);
        setVideoUrl(url);
        setLoading(false);
      } catch (e) {
        console.warn('[MarketingLecturePlayer] Failed to resolve video URL:', e);
        if (!cancelled) {
          setError('Could not load this video. Please check your connection and try again.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const hasKannada = !!presentation?.kannada_vimeo_mp4_url;
  const hasEnglish = !!presentation?.vimeo_mp4_url;
  const showLanguageSwitcher = hasKannada && hasEnglish;

  const switchLanguage = useCallback(
    (lang: PlayerLanguage) => {
      if (!presentation || lang === language) return;
      const url = resolvePlaybackUrl(presentation, lang);
      if (!url) return;
      setLanguage(lang);
      setVideoUrl(url);
    },
    [presentation, language],
  );

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  return (
    <View style={styles.container}>
      {/* Top bar: close + title */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          style={styles.closeButton}
          onPress={handleClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Close video"
          data-testid="button-close-marketing-player"
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </TouchableOpacity>
        <View style={styles.titleWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {!!subtitle && (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          )}
        </View>
        {showLanguageSwitcher ? (
          <View style={styles.langSwitcher}>
            {(['english', 'kannada'] as PlayerLanguage[]).map((lang) => (
              <TouchableOpacity
                key={lang}
                style={[styles.langChip, language === lang && styles.langChipActive]}
                onPress={() => switchLanguage(lang)}
                accessibilityLabel={`Switch to ${lang}`}
                data-testid={`button-lang-${lang}`}
              >
                <Text
                  style={[styles.langChipText, language === lang && styles.langChipTextActive]}
                >
                  {lang === 'english' ? 'EN' : 'ಕ'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : (
          // keep the title centered
          <View style={styles.closeButton} />
        )}
      </View>

      {/* Video area */}
      <View style={styles.videoArea}>
        {loading && (
          <View style={styles.centerFill}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.loadingText}>Loading video…</Text>
          </View>
        )}

        {!loading && error && (
          <View style={styles.centerFill}>
            <Ionicons name="alert-circle-outline" size={40} color="#FFFFFF" />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={handleClose}
              data-testid="button-error-close"
            >
              <Text style={styles.retryButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        )}

        {!loading && !error && videoUrl && (
          <Video
            ref={videoRef}
            // key forces a clean reload when the language (URL) changes —
            // single Video surface at all times (Android constraint).
            key={videoUrl}
            source={{ uri: videoUrl }}
            style={styles.video}
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay
            useNativeControls
            onError={(e) => {
              console.warn('[MarketingLecturePlayer] Playback error:', e);
              setError('Could not play this video. Please try again later.');
            }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: '#000',
    gap: 8,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  titleWrap: {
    flex: 1,
    alignItems: 'center',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  subtitle: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    marginTop: 1,
  },
  langSwitcher: {
    flexDirection: 'row',
    gap: 6,
  },
  langChip: {
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  langChipActive: {
    backgroundColor: '#FFFFFF',
  },
  langChipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  langChipTextActive: {
    color: '#000000',
  },
  videoArea: {
    flex: 1,
    backgroundColor: '#000',
  },
  video: {
    flex: 1,
    backgroundColor: '#000',
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 14,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});
