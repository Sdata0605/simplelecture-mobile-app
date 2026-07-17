import { useEffect, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Audio, Video, ResizeMode, VideoFullscreenUpdate } from 'expo-av';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useNavigation, useRoute, RouteProp, CommonActions } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { RootStackParamList } from '../navigation/AppNavigator';
import {
  fetchV4Presentation,
  resolvePlaybackUrl,
  PlayerLanguage,
  V4Presentation,
} from '../services/v4PlayerService';

const QUICK_ACTIONS = [
  { key: 'ai', icon: 'sparkles', label: 'Ask AI', desc: 'Have a doubt? Get help' },
  { key: 'questions', icon: 'help-circle-outline', label: 'Questions', desc: 'Browse Q&A' },
  { key: 'solutions', icon: 'bulb-outline', label: 'Solutions', desc: 'Step-by-step answers' },
  { key: 'assignments', icon: 'clipboard-outline', label: 'Assignments', desc: 'View your tasks' },
  { key: 'dpp', icon: 'disc-outline', label: 'DPP', desc: 'Daily Practice Problems' },
  { key: 'doubts', icon: 'chatbubble-ellipses-outline', label: 'Doubts', desc: 'Ask lecture doubts' },
  { key: 'pyqs', icon: 'document-text-outline', label: "PYQ's", desc: 'Previous year questions' },
  { key: 'results', icon: 'bar-chart-outline', label: 'Results', desc: 'View your scores' },
] as const;

const PRIMARY = '#2BBD6E';

/**
 * Marketing Lecture Player — plays a single pre-merged Vimeo progressive MP4.
 *
 * Portrait layout mirrors the AI Lecture Player: dark header on top, a fixed
 * 16:9 video strip below it, then a white scrollable area with the same
 * quick-action grid (shown only when opened from Topic Details, i.e. topic
 * context params exist). The MP4 URL is resolved at open time from the
 * lecture's presentation.json (vimeo_mp4_url / kannada_vimeo_mp4_url), never
 * hardcoded, so it survives Vimeo signature rotation. Progressive MP4 only —
 * no HLS, no proxying, no Vimeo iframe. Native fullscreen rotates landscape.
 */
export default function MarketingLecturePlayerScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'MarketingLecturePlayer'>>();
  const { jobId, title, subtitle, topicId, initialLanguage } = route.params;
  const insets = useSafeAreaInsets();

  // Quick actions only make sense when we came from Topic Details.
  const hasTopicContext = !!topicId;

  const videoRef = useRef<Video>(null);
  const [presentation, setPresentation] = useState<V4Presentation | null>(null);
  const [language, setLanguage] = useState<PlayerLanguage>('english');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeQuickAction, setActiveQuickAction] = useState<string | null>(null);

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
        // Honor the language chosen on the card if that version exists;
        // otherwise prefer English, falling back to Kannada if that's the
        // only one available.
        const requested: PlayerLanguage | null =
          initialLanguage === 'kannada' || initialLanguage === 'english'
            ? initialLanguage
            : null;
        const initialLang: PlayerLanguage =
          requested && resolvePlaybackUrl(pres, requested)
            ? requested
            : resolvePlaybackUrl(pres, 'english')
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
  }, [jobId, initialLanguage]);

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

  // Quick action: set openTab on the underlying TopicDetails route and go back —
  // same behavior as the AI Lecture Player's quick-action grid.
  const handleQuickAction = useCallback(
    (key: string) => {
      setActiveQuickAction(key);
      const state = navigation.getState();
      const currentIndex = state?.index ?? 0;
      if (currentIndex > 0) {
        const prevRoute = state.routes[currentIndex - 1];
        if (prevRoute?.name === 'TopicDetails') {
          navigation.dispatch({
            ...CommonActions.setParams({ ...(prevRoute.params as any), openTab: key }),
            source: prevRoute.key,
          });
        }
      }
      navigation.goBack();
    },
    [navigation],
  );

  // Rotate to landscape while the native fullscreen is presented, back to
  // portrait when dismissed — same pattern as the AI Lecture Player.
  const handleFullscreenUpdate = useCallback(
    ({ fullscreenUpdate }: { fullscreenUpdate: VideoFullscreenUpdate }) => {
      if (fullscreenUpdate === VideoFullscreenUpdate.PLAYER_DID_PRESENT) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE).catch(() => {});
      } else if (fullscreenUpdate === VideoFullscreenUpdate.PLAYER_WILL_DISMISS) {
        ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
          .then(() => {
            setTimeout(() => {
              ScreenOrientation.unlockAsync().catch(() => {});
            }, 300);
          })
          .catch(() => {});
      }
    },
    [],
  );

  // Safety: never leave the app stuck in landscape after this screen closes.
  useEffect(() => {
    return () => {
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP)
        .then(() => {
          setTimeout(() => {
            ScreenOrientation.unlockAsync().catch(() => {});
          }, 300);
        })
        .catch(() => {});
    };
  }, []);

  return (
    <View style={styles.container}>
      {/* Header — same dark indigo style as the AI Lecture Player */}
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        {showLanguageSwitcher && (
          <View style={styles.langSwitcher}>
            {(['english', 'kannada'] as PlayerLanguage[]).map((lang) => (
              <TouchableOpacity
                key={lang}
                style={[styles.langChip, language === lang && styles.langChipActive]}
                onPress={() => switchLanguage(lang)}
                accessibilityLabel={`Switch to ${lang}`}
                data-testid={`button-lang-${lang}`}
              >
                <Text style={[styles.langChipText, language === lang && styles.langChipTextActive]}>
                  {lang === 'english' ? 'EN' : 'ಕ'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <TouchableOpacity
          style={styles.headerClose}
          onPress={handleClose}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel="Close video"
          data-testid="button-close-marketing-player"
        >
          <Ionicons name="close" size={20} color="#FFFFFF" />
        </TouchableOpacity>
      </View>

      {/* Video — fixed 16:9 strip pinned below the header, like the AI player */}
      <View style={styles.videoStage}>
        {loading && (
          <View style={styles.centerFill}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.loadingText}>Loading video…</Text>
          </View>
        )}

        {!loading && error && (
          <View style={styles.centerFill}>
            <Ionicons name="alert-circle-outline" size={36} color="#FFFFFF" />
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
            onFullscreenUpdate={handleFullscreenUpdate}
            onError={(e) => {
              console.warn('[MarketingLecturePlayer] Playback error:', e);
              setError('Could not play this video. Please try again later.');
            }}
          />
        )}
      </View>

      {/* White area below the video — quick actions when opened from a topic */}
      <ScrollView style={styles.belowScroll} showsVerticalScrollIndicator={false}>
        <View style={styles.topicRow}>
          <TouchableOpacity onPress={handleClose} style={{ padding: 4 }} data-testid="button-back-marketing">
            <Ionicons name="arrow-back" size={20} color="#1f2937" />
          </TouchableOpacity>
          <Text style={styles.topicTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {!!subtitle && <Text style={styles.topicSubtitle}>{subtitle}</Text>}
        {hasTopicContext && (
          <>
            <Text style={styles.quickActionsHeading}>Quick Actions</Text>
            <View style={styles.quickActionsGrid}>
              {QUICK_ACTIONS.map((item) => {
                const isActive = activeQuickAction === item.key;
                return (
                  <TouchableOpacity
                    key={item.key}
                    style={[styles.quickActionButton, isActive && styles.quickActionButtonActive]}
                    onPress={() => handleQuickAction(item.key)}
                    data-testid={`button-quick-action-${item.key}`}
                  >
                    <View style={[styles.quickActionIcon, isActive && styles.quickActionIconActive]}>
                      <Ionicons name={item.icon as any} size={18} color={isActive ? '#fff' : '#6b7280'} />
                    </View>
                    <Text style={styles.quickActionLabel}>{item.label}</Text>
                    <Text style={styles.quickActionDesc}>{item.desc}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 6,
    backgroundColor: 'rgba(15, 15, 26, 0.98)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(99, 102, 241, 0.2)',
    gap: 8,
  },
  headerTitle: {
    flex: 1,
    color: '#e5e7eb',
    fontSize: 13,
    fontWeight: '500',
  },
  headerClose: {
    padding: 6,
  },
  langSwitcher: {
    flexDirection: 'row',
    gap: 6,
  },
  langChip: {
    paddingHorizontal: 10,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(99, 102, 241, 0.4)',
    backgroundColor: 'transparent',
  },
  langChipActive: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  langChipText: {
    color: 'rgba(230, 237, 243, 0.6)',
    fontSize: 12,
    fontWeight: '600',
  },
  langChipTextActive: {
    color: '#fff',
  },
  videoStage: {
    aspectRatio: 16 / 9,
    width: '100%',
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  video: {
    width: '100%',
    height: '100%',
    backgroundColor: '#000',
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 8,
  },
  loadingText: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 13,
  },
  errorText: {
    color: '#FFFFFF',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
  },
  retryButton: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  belowScroll: {
    flex: 1,
    backgroundColor: '#ffffff',
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    gap: 10,
  },
  topicTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  topicSubtitle: {
    fontSize: 13,
    color: '#6b7280',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  quickActionsHeading: {
    fontSize: 14,
    color: '#6b7280',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  quickActionsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 10,
    paddingBottom: 20,
  },
  quickActionButton: {
    width: '47%',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#ffffff',
    padding: 14,
  },
  quickActionButtonActive: {
    borderColor: PRIMARY,
    backgroundColor: 'rgba(43, 189, 110, 0.08)',
  },
  quickActionIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  quickActionIconActive: {
    backgroundColor: PRIMARY,
  },
  quickActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1f2937',
  },
  quickActionDesc: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 2,
  },
});
