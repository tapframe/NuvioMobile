import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  BackHandler,
  Animated,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import i18n from '../i18n';

const { width } = Dimensions.get('window');

interface AndroidUpdatePopupProps {
  visible: boolean;
  updateInfo: {
    isAvailable: boolean;
    manifest?: {
      id?: string;
      version?: string;
      description?: string;
    };
  };
  onUpdateNow: () => void;
  onUpdateLater: () => void;
  onDismiss: () => void;
  isInstalling?: boolean;
}

const AndroidUpdatePopup: React.FC<AndroidUpdatePopupProps> = ({
  visible,
  updateInfo,
  onUpdateNow,
  onUpdateLater,
  onDismiss,
  isInstalling = false,
}) => {
  const { currentTheme } = useTheme();
  const insets = useSafeAreaInsets();
  const backHandlerRef = useRef<any>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.8)).current;

  const getReleaseNotes = () => {
    const manifest: any = updateInfo?.manifest || {};
    return (
      manifest.description ||
      manifest.releaseNotes ||
      manifest.extra?.releaseNotes ||
      manifest.metadata?.releaseNotes ||
      ''
    );
  };

  // Handle Android back button
  useEffect(() => {
    if (visible) {
      backHandlerRef.current = BackHandler.addEventListener('hardwareBackPress', () => {
        if (!isInstalling) {
          onDismiss();
          return true;
        }
        return false;
      });
    }

    return () => {
      if (backHandlerRef.current) {
        backHandlerRef.current.remove();
        backHandlerRef.current = null;
      }
    };
  }, [visible, isInstalling, onDismiss]);

  // Animation effects
  useEffect(() => {
    if (visible) {
      // Animate in
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 100,
          friction: 8,
          useNativeDriver: true,
        }),
      ]).start();

      // Safety timeout
      timeoutRef.current = setTimeout(() => {
        console.warn('AndroidUpdatePopup: Timeout reached, auto-dismissing');
        onDismiss();
      }, 30000);
    } else {
      // Animate out
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 150,
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 0.8,
          duration: 150,
          useNativeDriver: true,
        }),
      ]).start();
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [visible, fadeAnim, scaleAnim, onDismiss]);

  if (!visible || !updateInfo.isAvailable) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <Animated.View 
        style={[
          styles.overlayContent,
          {
            opacity: fadeAnim,
            transform: [{ scale: scaleAnim }],
          }
        ]}
      >
        <TouchableOpacity 
          style={styles.backdrop}
          activeOpacity={1}
          onPress={onDismiss}
        />
        <View style={[
          styles.popup,
          {
            backgroundColor: currentTheme.colors.darkBackground || '#1a1a1a',
            borderColor: currentTheme.colors.elevation2 || '#333333',
            marginTop: insets.top + 20,
            marginBottom: insets.bottom + 20,
          }
        ]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={[
              styles.iconContainer,
              { backgroundColor: `${currentTheme.colors.primary}20` }
            ]}>
              <MaterialIcons 
                name="system-update" 
                size={32} 
                color={currentTheme.colors.primary} 
              />
            </View>
            <Text style={[
              styles.title,
              { color: currentTheme.colors.highEmphasis }
            ]}>
              Update Available
            </Text>
            <Text style={[
              styles.subtitle,
              { color: currentTheme.colors.mediumEmphasis }
            ]}>
              A new version of Nuvio is ready to install
            </Text>
          </View>

          {/* Update Info */}
          <View style={styles.updateInfo}>
            <View style={styles.infoRow}>
              <MaterialIcons 
                name="info-outline" 
                size={16} 
                color={currentTheme.colors.primary} 
              />
              <Text style={[
                styles.infoLabel,
                { color: currentTheme.colors.mediumEmphasis }
              ]}>
                Version:
              </Text>
              <Text
                style={[
                  styles.infoValue,
                  { color: currentTheme.colors.highEmphasis }
                ]}
                numberOfLines={3}
                ellipsizeMode="tail"
                selectable
              >
                {updateInfo.manifest?.id || 'Latest'}
              </Text>
            </View>
            
            {!!getReleaseNotes() && (
              <View style={styles.descriptionContainer}>
                <Text style={[
                  styles.description,
                  { color: currentTheme.colors.mediumEmphasis }
                ]}>
                  {getReleaseNotes()}
                </Text>
              </View>
            )}
          </View>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[
                styles.button,
                styles.primaryButton,
                { backgroundColor: currentTheme.colors.primary },
                isInstalling && styles.disabledButton
              ]}
              onPress={onUpdateNow}
              disabled={isInstalling}
              activeOpacity={0.8}
            >
              {isInstalling ? (
                <>
                  <MaterialIcons name="install-mobile" size={18} color="white" />
                  <Text style={styles.buttonText}>{i18n.t('components.installing')}</Text>
                </>
              ) : (
                <>
                  <MaterialIcons name="download" size={18} color="white" />
                  <Text style={styles.buttonText}>{i18n.t('components.update_now')}</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.secondaryActions}>
              <TouchableOpacity
                style={[
                  styles.button,
                  styles.secondaryButton,
                  { 
                    backgroundColor: currentTheme.colors.darkBackground || '#2a2a2a',
                    borderColor: currentTheme.colors.elevation3 || '#444444',
                  }
                ]}
                onPress={onUpdateLater}
                disabled={isInstalling}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.secondaryButtonText,
                  { color: currentTheme.colors.mediumEmphasis }
                ]}>
                  Later
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.button,
                  styles.secondaryButton,
                  { 
                    backgroundColor: currentTheme.colors.darkBackground || '#2a2a2a',
                    borderColor: currentTheme.colors.elevation3 || '#444444',
                  }
                ]}
                onPress={onDismiss}
                disabled={isInstalling}
                activeOpacity={0.7}
              >
                <Text style={[
                  styles.secondaryButtonText,
                  { color: currentTheme.colors.mediumEmphasis }
                ]}>
                  Dismiss
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  overlayContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent',
  },
  popup: {
    width: Math.min(width - 40, 400),
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: '#1a1a1a',
    elevation: 15,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 20,
  },
  iconContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 22,
  },
  updateInfo: {
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 8,
    marginRight: 8,
    marginTop: 2,
    minWidth: 60,
  },
  infoValue: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
    lineHeight: 20,
  },
  descriptionContainer: {
    marginTop: 8,
    padding: 12,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  description: {
    fontSize: 14,
    lineHeight: 20,
  },
  actions: {
    paddingHorizontal: 24,
    paddingBottom: 20,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
    gap: 8,
    marginBottom: 12,
  },
  primaryButton: {
    elevation: 4,
  },
  secondaryButton: {
    borderWidth: 1,
    flex: 1,
    marginHorizontal: 4,
  },
  disabledButton: {
    opacity: 0.6,
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  secondaryActions: {
    flexDirection: 'row',
    gap: 8,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '500',
  },
});

export default AndroidUpdatePopup;
