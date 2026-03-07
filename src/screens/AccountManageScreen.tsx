import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar, Platform, Animated, Easing, TextInput, ActivityIndicator } from 'react-native';
import FastImage from '@d11/react-native-fast-image';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import { useAccount } from '../contexts/AccountContext';
import { useTheme } from '../contexts/ThemeContext';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import CustomAlert from '../components/CustomAlert';

const AccountManageScreen: React.FC = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { user, signOut, updateProfile } = useAccount();
  const { currentTheme } = useTheme();
  const { t } = useTranslation();

  const headerOpacity = useRef(new Animated.Value(0)).current;
  const headerTranslateY = useRef(new Animated.Value(8)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerOpacity, { toValue: 1, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(headerTranslateY, { toValue: 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(contentOpacity, { toValue: 1, duration: 320, delay: 80, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(contentTranslateY, { toValue: 0, duration: 320, delay: 80, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [headerOpacity, headerTranslateY, contentOpacity, contentTranslateY]);

  const initial = useMemo(() => (user?.email?.[0]?.toUpperCase() || 'U'), [user?.email]);
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl || '');
  const [saving, setSaving] = useState(false);
  const [avatarError, setAvatarError] = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');
  const [alertActions, setAlertActions] = useState<any[]>([]);

  useEffect(() => {
    // Reset image error state when URL changes
    setAvatarError(false);
  }, [avatarUrl]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    const err = await updateProfile({ displayName: displayName.trim() || undefined, avatarUrl: avatarUrl.trim() || undefined });
    if (err) {
      setAlertTitle(t('common.error', 'Error'));
      setAlertMessage(err);
      setAlertActions([{ label: t('common.ok', 'OK'), onPress: () => { } }]);
      setAlertVisible(true);
    }
    setSaving(false);
  };

  const handleSignOut = () => {
    setAlertTitle(t('account_manage.sign_out'));
    setAlertMessage(t('components.are_you_sure_sign_out'));
    setAlertActions([
      { label: t('common.cancel', 'Cancel'), onPress: () => { } },
      {
        label: t('account_manage.sign_out'),
        onPress: async () => {
          try {
            await signOut();
            // @ts-ignore
            navigation.goBack();
          } catch (_) { }
        },
        style: { opacity: 1 },
      },
    ]);
    setAlertVisible(true);
  };

  return (
    <View style={[styles.container, { backgroundColor: currentTheme.colors.darkBackground }]}>
      <StatusBar translucent barStyle="light-content" backgroundColor="transparent" />

      {/* Header */}
      <Animated.View
        style={[
          styles.header,
          {
            paddingTop: (Platform.OS === 'android' ? (StatusBar.currentHeight || 0) : insets.top) + 12,
            opacity: headerOpacity,
            transform: [{ translateY: headerTranslateY }],
          },
        ]}
      >
        <LinearGradient
          colors={[currentTheme.colors.darkBackground, '#111318']}
          style={StyleSheet.absoluteFill}
        />
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <MaterialIcons name="arrow-back" size={22} color={currentTheme.colors.white} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: currentTheme.colors.white }]}>{t('account_manage.title')}</Text>
        <View style={{ width: 22, height: 22 }} />
      </Animated.View>

      {/* Content */}
      <Animated.View style={[styles.content, { opacity: contentOpacity, transform: [{ translateY: contentTranslateY }] }]}>
        {/* Profile Badge */}
        <View style={styles.profileContainer}>
          {avatarUrl && !avatarError ? (
            <View style={[styles.avatar, { overflow: 'hidden' }]}>
              <FastImage
                source={{ uri: avatarUrl }}
                style={styles.avatarImage}
                resizeMode={FastImage.resizeMode.cover}
                onError={() => setAvatarError(true)}
              />
            </View>
          ) : (
            <View style={[styles.avatar, { backgroundColor: currentTheme.colors.elevation2 }]}>
              <Text style={styles.avatarText}>{(displayName?.[0] || initial)}</Text>
            </View>
          )}
        </View>

        {/* Account details card */}
        <View style={[styles.card, { backgroundColor: currentTheme.colors.elevation1, borderColor: currentTheme.colors.elevation2 }]}>
          <View style={styles.itemRow}>
            <View style={styles.itemLeft}>
              <MaterialIcons name="badge" size={20} color={currentTheme.colors.primary} />
              <Text style={[styles.itemTitle, { color: currentTheme.colors.highEmphasis }]}>{t('account_manage.display_name')}</Text>
            </View>
            <TextInput
              placeholder={t('account_manage.display_name_placeholder')}
              placeholderTextColor={currentTheme.colors.mediumEmphasis}
              style={[styles.input, { color: currentTheme.colors.white }]}
              value={displayName}
              onChangeText={setDisplayName}
              numberOfLines={1}
            />
          </View>

          <View style={styles.divider} />

          <View style={[styles.itemRow, Platform.OS === 'android' && styles.itemRowCompact]}>
            <View style={styles.itemLeft}>
              <MaterialIcons name="image" size={20} color={currentTheme.colors.primary} />
              <Text style={[styles.itemTitle, { color: currentTheme.colors.highEmphasis }]}>{t('account_manage.avatar_url')}</Text>
            </View>
            <TextInput
              placeholder="https://..."
              placeholderTextColor={currentTheme.colors.mediumEmphasis}
              style={[styles.input, { color: currentTheme.colors.white }]}
              value={avatarUrl}
              onChangeText={setAvatarUrl}
              autoCapitalize="none"
              numberOfLines={1}
            />
          </View>

          <View style={styles.divider} />

          <View style={styles.itemRow}>
            <View style={styles.itemLeft}>
              <MaterialIcons name="account-circle" size={20} color={currentTheme.colors.primary} />
              <Text style={[styles.itemTitle, { color: currentTheme.colors.highEmphasis }]}>{t('account_manage.email')}</Text>
            </View>
            <Text style={[styles.itemValue, { color: currentTheme.colors.mediumEmphasis }]} numberOfLines={1}>
              {user?.email || '—'}
            </Text>
          </View>

          <View style={styles.divider} />

          <View style={styles.itemRow}>
            <View style={styles.itemLeft}>
              <MaterialIcons name="fingerprint" size={20} color={currentTheme.colors.primary} />
              <Text style={[styles.itemTitle, { color: currentTheme.colors.highEmphasis }]}>{t('account_manage.user_id')}</Text>
            </View>
            <Text style={[styles.itemValue, { color: currentTheme.colors.mediumEmphasis }]} numberOfLines={1}>
              {user?.id}
            </Text>
          </View>
        </View>

        {/* Save and Sign out */}
        <TouchableOpacity
          activeOpacity={0.85}
          style={[styles.saveButton, { backgroundColor: currentTheme.colors.elevation2, borderColor: currentTheme.colors.elevation2 }]}
          onPress={handleSave}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={currentTheme.colors.white} />
          ) : (
            <>
              <MaterialIcons name="save-alt" size={18} color={currentTheme.colors.white} style={{ marginRight: 8 }} />
              <Text style={styles.saveText}>{t('account_manage.save_changes')}</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          style={[
            styles.signOutButton,
            { backgroundColor: currentTheme.colors.primary },
          ]}
          onPress={handleSignOut}
        >
          <MaterialIcons name="logout" size={18} color="#fff" style={{ marginRight: 8 }} />
          <Text style={styles.signOutText}>{t('account_manage.sign_out')}</Text>
        </TouchableOpacity>
      </Animated.View>
      <CustomAlert
        visible={alertVisible}
        title={alertTitle}
        message={alertMessage}
        actions={alertActions}
        onClose={() => setAlertVisible(false)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerBack: {
    padding: 4,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  profileContainer: {
    alignItems: 'center',
    marginBottom: 12,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 24,
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
  },
  itemRowCompact: {
    paddingVertical: 6,
  },
  input: {
    flex: 1,
    textAlign: 'right',
    paddingVertical: 6,
    marginLeft: 12,
  },
  itemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  itemValue: {
    fontSize: 14,
    maxWidth: '65%',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  signOutButton: {
    marginTop: 16,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  signOutText: {
    color: '#fff',
    fontWeight: '700',
  },
  saveButton: {
    marginTop: 12,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: StyleSheet.hairlineWidth,
  },
  saveText: {
    color: '#fff',
    fontWeight: '700',
  },
});

export default AccountManageScreen;


