import React, { useEffect, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  useColorScheme,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { useTheme } from '../contexts/ThemeContext';
import { Portal } from 'react-native-paper';

interface CustomAlertProps {
  visible: boolean;
  title: string;
  message: string;
  subtitle?: string;
  onClose: () => void;
  actions?: Array<{
    label: string;
    onPress: () => void;
    style?: object;
  }>;
}

export const CustomAlert = ({
  visible,
  title,
  message,
  subtitle,
  onClose,
  actions = [
    { label: 'OK', onPress: onClose }
  ],
}: CustomAlertProps) => {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.95);
  const { currentTheme } = useTheme();
  // Using hardcoded dark theme values to match SeriesContent modal
  const themeColors = currentTheme.colors;

  useEffect(() => {
    const duration = Platform.OS === 'android' ? 200 : 150;
    if (visible) {
      opacity.value = withTiming(1, { duration });
      scale.value = withTiming(1, { duration });
    } else {
      opacity.value = withTiming(0, { duration });
      scale.value = withTiming(0.95, { duration });
    }
  }, [visible]);

  const overlayStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const alertStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  // Safe action handler to prevent crashes
  const handleActionPress = useCallback((action: { label: string; onPress: () => void; style?: object }) => {
    try {
      action.onPress();
      onClose();
    } catch (error) {
      console.warn('[CustomAlert] Error in action handler:', error);
      onClose();
    }
  }, [onClose]);

  // Use Portal with Modal for proper rendering and animations
  return (
    <Portal>
      <Modal
        visible={visible}
        transparent
        animationType="none"
        onRequestClose={onClose}
        statusBarTranslucent={true}
        hardwareAccelerated={true}
        supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}
      >
        <Animated.View
          style={[
            styles.overlay,
            { backgroundColor: 'rgba(0, 0, 0, 0.85)' },
            overlayStyle
          ]}
        >
          <Pressable style={styles.overlayPressable} onPress={onClose} />
          <View style={styles.centered}>
            <Animated.View style={[
              styles.alertContainer,
              alertStyle,
            ]}>
              {/* Title */}
              <Text style={styles.title}>
                {title}
              </Text>

              {/* Message */}
              <Text style={styles.message}>
                {message}
              </Text>

              {/* Subtitle / tooltip */}
              {subtitle ? (
                <Text style={styles.subtitle}>
                  {subtitle}
                </Text>
              ) : null}

              {/* Actions */}
              <View style={[
                styles.actionsRow,
                actions.length === 1 && { justifyContent: 'center' }
              ]}>
                {actions.map((action, idx) => {
                  const isPrimary = idx === actions.length - 1;
                  return (
                    <TouchableOpacity
                      key={action.label}
                      style={[
                        styles.actionButton,
                        isPrimary
                          ? { backgroundColor: themeColors.primary }
                          : styles.secondaryButton,
                        action.style,
                        actions.length === 1 && { minWidth: 120, maxWidth: '100%' }
                      ]}
                      onPress={() => handleActionPress(action)}
                      activeOpacity={0.7}
                    >
                      <Text style={[
                        styles.actionText,
                        isPrimary
                          ? { color: '#FFFFFF' }
                          : { color: '#FFFFFF' }
                      ]}>
                        {action.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Animated.View>
          </View>
        </Animated.View>
      </Modal>
    </Portal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  overlayPressable: {
    ...StyleSheet.absoluteFillObject,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    width: '100%',
  },
  alertContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#1E1E1E', // Solid opaque dark background
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.51,
        shadowRadius: 13.16,
      },
      android: {
        elevation: 20,
      },
    }),
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  message: {
    color: '#AAAAAA',
    fontSize: 15,
    marginBottom: 8,
    textAlign: 'center',
    lineHeight: 22,
    letterSpacing: 0.1,
  },
  subtitle: {
    color: '#666666',
    fontSize: 12,
    marginBottom: 24,
    textAlign: 'center',
    lineHeight: 18,
    letterSpacing: 0.1,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
  },
  actionButton: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 12,
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1, // Distribute space
    maxWidth: 200, // But limit width
  },
  secondaryButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },
  actionText: {
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});

export default CustomAlert;
