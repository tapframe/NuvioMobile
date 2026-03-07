import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, TextInput, Text, TouchableOpacity, StyleSheet, ActivityIndicator, SafeAreaView, KeyboardAvoidingView, Platform, Animated, Easing, Keyboard, StatusBar, useWindowDimensions, Linking } from 'react-native';
import { mmkvStorage } from '../services/mmkvStorage';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useAccount } from '../contexts/AccountContext';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as Haptics from 'expo-haptics';
import { useToast } from '../contexts/ToastContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const EMAIL_CONFIRMATION_REQUIRED_PREFIX = '__EMAIL_CONFIRMATION__';
const AUTH_BG_GRADIENT = ['#07090F', '#0D1020', '#140B24'] as const;

const normalizeAuthErrorMessage = (input: string): string => {
  const raw = (input || '').trim();
  if (!raw) return 'Authentication failed';

  let parsed: any = null;
  if (raw.startsWith('{') && raw.endsWith('}')) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  const code = (parsed?.error_code || parsed?.code || '').toString().toLowerCase();
  const message = (parsed?.msg || parsed?.message || raw).toString();

  if (code === 'invalid_credentials' || /invalid login credentials/i.test(message)) {
    return 'Invalid email or password';
  }
  if (code === 'email_not_confirmed' || /email not confirmed/i.test(message)) {
    return 'Email not confirmed. Check your inbox or Spam/Junk folder, verify your account, then sign in.';
  }

  return message;
};

const AuthScreen: React.FC = () => {
  const { width, height } = useWindowDimensions();
  const isTablet = width >= 768;
  const { currentTheme } = useTheme();
  const { signIn, signUp } = useAccount();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const fromOnboarding = !!route?.params?.fromOnboarding;
  const insets = useSafeAreaInsets();
  const safeTopInset = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : 0);
  const backButtonTop = safeTopInset + 8;
  const { showError, showSuccess } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Subtle, performant animations
  const introOpacity = useRef(new Animated.Value(0)).current;
  const introTranslateY = useRef(new Animated.Value(10)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const cardTranslateY = useRef(new Animated.Value(12)).current;
  const ctaScale = useRef(new Animated.Value(1)).current;
  const titleOpacity = useRef(new Animated.Value(1)).current;
  const titleTranslateY = useRef(new Animated.Value(0)).current;
  const ctaTextOpacity = useRef(new Animated.Value(1)).current;
  const ctaTextTranslateY = useRef(new Animated.Value(0)).current;
  const modeAnim = useRef(new Animated.Value(0)).current; // 0 = signin, 1 = signup
  const [switchWidth, setSwitchWidth] = useState(0);
  // Legacy local toast state removed in favor of global toast
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(introOpacity, {
        toValue: 1,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(introTranslateY, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 360,
        delay: 90,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardTranslateY, {
        toValue: 0,
        duration: 360,
        delay: 90,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [cardOpacity, cardTranslateY, introOpacity, introTranslateY]);

  // Animate on mode change
  useEffect(() => {
    Animated.timing(modeAnim, {
      toValue: mode === 'signin' ? 0 : 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    Animated.sequence([
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.timing(titleTranslateY, { toValue: -6, duration: 120, useNativeDriver: true }),
        Animated.timing(ctaTextOpacity, { toValue: 0, duration: 120, useNativeDriver: true }),
        Animated.timing(ctaTextTranslateY, { toValue: -4, duration: 120, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(titleOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(titleTranslateY, { toValue: 0, duration: 180, useNativeDriver: true }),
        Animated.timing(ctaTextOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(ctaTextTranslateY, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]),
    ]).start();
  }, [mode, ctaTextOpacity, ctaTextTranslateY, modeAnim, titleOpacity, titleTranslateY]);

  // Hide/show header when keyboard toggles
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: any) => {
      const kh = e?.endCoordinates?.height ?? 0;
      setKeyboardHeight(kh);
    };
    const onHide = () => {
      setKeyboardHeight(0);
    };
    const subShow = Keyboard.addListener(showEvt, onShow as any);
    const subHide = Keyboard.addListener(hideEvt, onHide as any);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  const isEmailValid = useMemo(() => /\S+@\S+\.\S+/.test(email.trim()), [email]);
  const isPasswordValid = useMemo(() => password.length >= 6, [password]);
  const isConfirmValid = useMemo(() => (mode === 'signin') || confirmPassword.length >= 6, [confirmPassword, mode]);
  const passwordsMatch = useMemo(() => (mode === 'signin') || confirmPassword === password, [confirmPassword, password, mode]);
  const canSubmit = isEmailValid && isPasswordValid && (mode === 'signin' || (isConfirmValid && passwordsMatch));

  const handleSubmit = async () => {
    if (loading) return;

    if (!isEmailValid) {
      const msg = 'Enter a valid email address';
      setError(msg);
      showError('Invalid Email', 'Enter a valid email address');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    if (!isPasswordValid) {
      const msg = 'Password must be at least 6 characters';
      setError(msg);
      showError('Password Too Short', 'Password must be at least 6 characters');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    if (mode === 'signup' && !passwordsMatch) {
      const msg = 'Passwords do not match';
      setError(msg);
      showError('Passwords Don\'t Match', 'Passwords do not match');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    setLoading(true);
    setError(null);
    const err = mode === 'signin' ? await signIn(email.trim(), password) : await signUp(email.trim(), password);
    if (err) {
      if (mode === 'signup' && err.startsWith(EMAIL_CONFIRMATION_REQUIRED_PREFIX)) {
        setError(null);
        setMode('signin');
        setPassword('');
        setConfirmPassword('');
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setLoading(false);
        return;
      }

      const cleanError = normalizeAuthErrorMessage(err);
      setError(cleanError);
      showError('Authentication Failed', cleanError);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } else {
      const msg = mode === 'signin' ? 'Logged in successfully' : 'Sign up successful';
      showSuccess('Success', msg);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

      // Navigate to main tabs after successful authentication
      navigation.reset({ index: 0, routes: [{ name: 'MainTabs' as never }] } as any);
    }
    setLoading(false);
  };

  const handleSkipAuth = async () => {
    try {
      await mmkvStorage.setItem('showLoginHintToastOnce', 'true');
    } catch {}
    navigation.reset({ index: 0, routes: [{ name: 'MainTabs' as never }] } as any);
  };

  // showToast helper replaced with direct calls to toast.* API

  return (
    <View style={{ flex: 1 }}>
      <LinearGradient
        colors={AUTH_BG_GRADIENT}
        style={StyleSheet.absoluteFill}
      />

      {/* Background Pattern (iOS only) */}
      {Platform.OS !== 'android' && (
        <View style={styles.backgroundPattern}>
          {Array.from({ length: 20 }).map((_, i) => (
            <View 
              key={i}
              style={[
                styles.patternDot,
                {
                  left: (i % 5) * (width / 4),
                  top: Math.floor(i / 5) * (height / 4),
                  opacity: 0.03 + (i % 3) * 0.02,
                }
              ]}
            />
          ))}
        </View>
      )}

      <SafeAreaView style={{ flex: 1 }}>
        {navigation.canGoBack() && (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={[styles.backButton, { top: backButtonTop }]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="arrow-back" size={22} color={currentTheme.colors.white} />
          </TouchableOpacity>
        )}

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <Animated.View
            style={[
              styles.centerContainer,
              isTablet ? styles.centerContainerTablet : null,
              keyboardHeight > 0
                ? {
                    justifyContent: 'flex-start',
                    paddingTop: Platform.OS === 'ios' ? 12 : safeTopInset + 8,
                  }
                : null,
            ]}
          >
            <Animated.View
              style={[
                styles.centerHeader,
                isTablet ? styles.centerHeaderTablet : null,
                keyboardHeight > 0 ? styles.centerHeaderCompact : null,
                {
                  opacity: introOpacity,
                  transform: [{ translateY: introTranslateY }],
                },
              ]}
            >
              <Animated.Text style={[styles.heading, { color: currentTheme.colors.white, opacity: titleOpacity, transform: [{ translateY: titleTranslateY }] }]}>
                {mode === 'signin' ? 'Welcome back' : 'Create your account'}
              </Animated.Text>
              {keyboardHeight === 0 && (
                <Text style={[styles.subheading, { color: currentTheme.colors.textMuted }]}>
                  Sync your addons, progress and settings across devices
                </Text>
              )}
            </Animated.View>

            <Animated.View style={[styles.card, isTablet ? styles.cardTablet : null, keyboardHeight > 0 ? styles.cardCompact : null, { 
              backgroundColor: Platform.OS === 'android' ? '#121212' : 'rgba(255,255,255,0.02)',
              borderColor: Platform.OS === 'android' ? '#1f1f1f' : 'rgba(255,255,255,0.06)',
              ...(Platform.OS !== 'android' ? {
                shadowColor: currentTheme.colors.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.1,
                shadowRadius: 20,
              } : {}),
              opacity: cardOpacity,
              transform: [{ translateY: cardTranslateY }],
            }]}>                
              
              {/* Mode Toggle */}
              <View
                onLayout={(e) => setSwitchWidth(e.nativeEvent.layout.width)}
                style={[styles.switchRow, { backgroundColor: Platform.OS === 'android' ? '#1a1a1a' : 'rgba(255,255,255,0.04)' }]}
              >
                {/* Animated indicator */}
                <Animated.View
                  pointerEvents="none"
                  style={[
                    styles.switchIndicator,
                    {
                      width: Math.max(0, (switchWidth - 6) / 2),
                      backgroundColor: Platform.OS === 'android' ? '#2a2a2a' : currentTheme.colors.primary,
                      transform: [
                        {
                          translateX: modeAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, Math.max(0, (switchWidth - 6) / 2)],
                          }),
                        },
                      ],
                    },
                  ]}
                />
                <TouchableOpacity
                  style={[
                    styles.switchButton,
                  ]}
                  onPress={() => setMode('signin')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.switchText, { color: mode === 'signin' ? '#fff' : currentTheme.colors.textMuted }]}>
                    Sign In
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.switchButton}
                  onPress={() => setMode('signup')}
                  activeOpacity={0.8}
                >
                  <Text style={[
                    styles.switchText, 
                    { 
                      color: mode === 'signup' ? '#fff' : currentTheme.colors.textMuted
                    }
                  ]}>
                    Sign Up
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Email Input */}
              <View style={[styles.inputContainer]}>
                <View style={[styles.inputRow, { 
                  backgroundColor: Platform.OS === 'android' ? '#1a1a1a' : 'rgba(255,255,255,0.03)', 
                  borderColor: Platform.OS === 'android' ? '#2a2a2a' : (isEmailValid || !email ? 'rgba(255,255,255,0.08)' : 'rgba(255,107,107,0.4)'),
                  borderWidth: 1,
                }]}>                
                  <View style={[styles.iconContainer, { backgroundColor: Platform.OS === 'android' ? '#222' : (isEmailValid ? 'rgba(46,160,67,0.15)' : 'rgba(255,255,255,0.05)') }]}>                
                    <MaterialIcons 
                      name="mail-outline" 
                      size={18} 
                      color={Platform.OS === 'android' ? currentTheme.colors.textMuted : (isEmailValid ? '#2EA043' : currentTheme.colors.textMuted)} 
                    />
                  </View>
                  <TextInput
                    placeholder="Email address"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    style={[styles.input, { color: currentTheme.colors.white }]}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    value={email}
                    onChangeText={setEmail}
                    returnKeyType="next"
                  />
                  {Platform.OS !== 'android' && isEmailValid && (
                    <MaterialIcons name="check-circle" size={16} color="#2EA043" style={{ marginRight: 12 }} />
                  )}
                </View>
              </View>

              {/* Password Input */}
              <View style={styles.inputContainer}>
                <View style={[styles.inputRow, { 
                  backgroundColor: Platform.OS === 'android' ? '#1a1a1a' : 'rgba(255,255,255,0.03)', 
                  borderColor: Platform.OS === 'android' ? '#2a2a2a' : (isPasswordValid || !password ? 'rgba(255,255,255,0.08)' : 'rgba(255,107,107,0.4)'),
                  borderWidth: 1,
                }]}>                
                  <View style={[styles.iconContainer, { backgroundColor: Platform.OS === 'android' ? '#222' : (isPasswordValid ? 'rgba(46,160,67,0.15)' : 'rgba(255,255,255,0.05)') }]}>                
                    <MaterialIcons 
                      name="lock-outline" 
                      size={18} 
                      color={Platform.OS === 'android' ? currentTheme.colors.textMuted : (isPasswordValid ? '#2EA043' : currentTheme.colors.textMuted)} 
                    />
                  </View>
                  <TextInput
                    placeholder="Password (min 6 characters)"
                    placeholderTextColor="rgba(255,255,255,0.4)"
                    style={[styles.input, { color: currentTheme.colors.white }]}
                    autoCapitalize="none"
                    secureTextEntry={!showPassword}
                    value={password}
                    onChangeText={setPassword}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                  />
                  <TouchableOpacity onPress={() => setShowPassword(p => !p)} style={styles.eyeButton}>
                    <MaterialIcons 
                      name={showPassword ? 'visibility-off' : 'visibility'} 
                      size={16} 
                      color={currentTheme.colors.textMuted} 
                    />
                  </TouchableOpacity>
                  {Platform.OS !== 'android' && isPasswordValid && (
                    <MaterialIcons name="check-circle" size={16} color="#2EA043" style={{ marginRight: 12 }} />
                  )}
                </View>
              </View>

              {mode === 'signin' && (
                <TouchableOpacity
                  onPress={() => Linking.openURL('https://nuvioapp.space/account/reset-password')}
                  activeOpacity={0.75}
                  style={styles.forgotPasswordButton}
                >
                  <Text style={[styles.forgotPasswordText, { color: currentTheme.colors.textMuted }]}>Forgot password?</Text>
                </TouchableOpacity>
              )}

              {/* Confirm Password (signup only) */}
              {mode === 'signup' && (
                <View style={styles.inputContainer}>
                  <View style={[styles.inputRow, { 
                    backgroundColor: Platform.OS === 'android' ? '#1a1a1a' : 'rgba(255,255,255,0.03)', 
                    borderColor: Platform.OS === 'android' ? '#2a2a2a' : ((passwordsMatch && (isConfirmValid || !confirmPassword)) ? 'rgba(255,255,255,0.08)' : 'rgba(255,107,107,0.4)'),
                    borderWidth: 1,
                  }]}>                
                    <View style={[styles.iconContainer, { backgroundColor: Platform.OS === 'android' ? '#222' : ((passwordsMatch && isConfirmValid) ? 'rgba(46,160,67,0.15)' : 'rgba(255,255,255,0.05)') }]}>                
                      <MaterialIcons 
                        name="lock-outline" 
                        size={18} 
                        color={Platform.OS === 'android' ? currentTheme.colors.textMuted : ((passwordsMatch && isConfirmValid) ? '#2EA043' : currentTheme.colors.textMuted)} 
                      />
                    </View>
                    <TextInput
                      placeholder="Confirm password"
                      placeholderTextColor="rgba(255,255,255,0.4)"
                      style={[styles.input, { color: currentTheme.colors.white }]}
                      autoCapitalize="none"
                      secureTextEntry={!showConfirm}
                      value={confirmPassword}
                      onChangeText={setConfirmPassword}
                      returnKeyType="done"
                      onSubmitEditing={handleSubmit}
                    />
                    <TouchableOpacity onPress={() => setShowConfirm(p => !p)} style={styles.eyeButton}>
                      <MaterialIcons 
                        name={showConfirm ? 'visibility-off' : 'visibility'} 
                        size={16} 
                        color={currentTheme.colors.textMuted} 
                      />
                    </TouchableOpacity>
                    {Platform.OS !== 'android' && passwordsMatch && isConfirmValid && (
                      <MaterialIcons name="check-circle" size={16} color="#2EA043" style={{ marginRight: 12 }} />
                    )}
                  </View>
                </View>
              )}

              {/* Error */}
              {!!error && (
                <View style={styles.errorRow}>
                  <MaterialIcons name="error-outline" size={16} color="#ff6b6b" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              {/* Submit Button */}
              <Animated.View style={{ transform: [{ scale: ctaScale }] }}>
                <TouchableOpacity
                  style={[
                    styles.ctaButton, 
                    { 
                      backgroundColor: canSubmit ? currentTheme.colors.primary : 'rgba(255,255,255,0.08)',
                      ...(Platform.OS !== 'android' ? {
                        shadowColor: canSubmit ? currentTheme.colors.primary : 'transparent',
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: canSubmit ? 0.3 : 0,
                        shadowRadius: 12,
                      } : {}),
                    }
                  ]}
                  onPress={handleSubmit}
                  onPressIn={() => {
                    Animated.spring(ctaScale, {
                      toValue: 0.98,
                      useNativeDriver: true,
                      speed: 20,
                      bounciness: 0,
                    }).start();
                  }}
                  onPressOut={() => {
                    Animated.spring(ctaScale, {
                      toValue: 1,
                      useNativeDriver: true,
                      speed: 20,
                      bounciness: 6,
                    }).start();
                  }}
                  activeOpacity={0.85}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Animated.Text style={[styles.ctaText, { opacity: ctaTextOpacity, transform: [{ translateY: ctaTextTranslateY }] }]}>
                      {mode === 'signin' ? 'Sign In' : 'Create Account'}
                    </Animated.Text>
                  )}
                </TouchableOpacity>
              </Animated.View>

              {/* Switch Mode */}
              <TouchableOpacity
                onPress={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
                activeOpacity={0.7}
                style={{ marginTop: 16 }}
              >
                <Text style={[styles.switchModeText, { color: currentTheme.colors.textMuted }]}>
                  {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
                  <Text style={{ color: currentTheme.colors.primary, fontWeight: '600' }}>
                    {mode === 'signin' ? 'Sign up' : 'Sign in'}
                  </Text>
                </Text>
              </TouchableOpacity>

              {/* Skip sign in - more prominent when coming from onboarding */}
              <TouchableOpacity
                onPress={handleSkipAuth}
                activeOpacity={0.85}
                style={[
                  { marginTop: 12, alignSelf: 'center' },
                  fromOnboarding && {
                    marginTop: 18,
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                    borderRadius: 10,
                    backgroundColor: 'rgba(255,255,255,0.06)',
                  },
                ]}
              >
                <Text style={{ 
                  color: fromOnboarding ? currentTheme.colors.white : currentTheme.colors.textMuted, 
                  textAlign: 'center',
                  fontWeight: fromOnboarding ? '700' : '500',
                }}>
                  Continue without an account
                </Text>
              </TouchableOpacity>
            </Animated.View>

          </Animated.View>
        </KeyboardAvoidingView>
        {/* Toasts rendered globally in App root */}
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  backgroundPattern: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  patternDot: {
    position: 'absolute',
    width: 2,
    height: 2,
    backgroundColor: '#fff',
    borderRadius: 1,
  },
  header: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  centerHeader: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 18,
    paddingHorizontal: 20,
  },
  centerHeaderTablet: {
    maxWidth: 620,
  },
  centerHeaderCompact: {
    marginBottom: 10,
  },
  logoContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logo: {
    width: 180,
    height: 54,
    zIndex: 2,
  },
  logoGlow: {
    position: 'absolute',
    width: 200,
    height: 70,
    backgroundColor: 'rgba(229, 9, 20, 0.1)',
    borderRadius: 35,
    zIndex: 1,
  },
  heading: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subheading: {
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    paddingHorizontal: 20,
    marginTop: 1,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 28,
  },
  centerContainerTablet: {
    paddingHorizontal: 36,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    elevation: 20,
  },
  cardTablet: {
    maxWidth: 560,
  },
  cardCompact: {
    padding: 18,
    borderRadius: 16,
  },
  switchRow: {
    flexDirection: 'row',
    borderRadius: 14,
    padding: 3,
    marginBottom: 24,
    position: 'relative',
    overflow: 'hidden',
  },
  switchIndicator: {
    position: 'absolute',
    top: 3,
    bottom: 3,
    left: 3,
    borderRadius: 12,
  },
  switchButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 0,
  },
  switchText: {
    fontWeight: '700',
    fontSize: 15,
    letterSpacing: 0.2,
  },
  inputContainer: {
    marginBottom: 16,
  },
  inputRow: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 4,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 0,
    fontWeight: '500',
  },
  eyeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 4,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  errorText: {
    color: '#ff6b6b',
    marginLeft: 8,
    fontSize: 13,
    fontWeight: '500',
  },
  ctaButton: {
    height: 56,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    elevation: 0,
  },
  ctaText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
    letterSpacing: 0.3,
  },
  backButton: {
    position: 'absolute',
    left: 16,
    zIndex: 20,
  },
  switchModeText: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '500',
  },
  forgotPasswordButton: {
    alignSelf: 'flex-end',
    marginTop: -6,
    marginBottom: 12,
  },
  forgotPasswordText: {
    fontSize: 13,
    fontWeight: '600',
  },
});

export default AuthScreen;
