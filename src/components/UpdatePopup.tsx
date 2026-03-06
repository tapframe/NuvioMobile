import React from 'react';
import {
	View,
	Text,
	StyleSheet,
	TouchableOpacity,
	Modal,
	Dimensions,
	Platform,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import AndroidUpdatePopup from './AndroidUpdatePopup';
import { t } from 'i18next';

const { width, height } = Dimensions.get('window');

interface UpdatePopupProps {
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

const UpdatePopup: React.FC<UpdatePopupProps> = ({
	visible,
	updateInfo,
	onUpdateNow,
	onUpdateLater,
	onDismiss,
	isInstalling = false,
}) => {
	const { currentTheme } = useTheme();
	const insets = useSafeAreaInsets();

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

	const handleUpdateNow = () => {
		if (Platform.OS === 'ios') {
			Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
		}
		onUpdateNow();
	};

	const handleUpdateLater = () => {
		if (Platform.OS === 'ios') {
			Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		}
		onUpdateLater();
	};

	const handleDismiss = () => {
		if (Platform.OS === 'ios') {
			Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		}
		onDismiss();
	};

	if (!visible || !updateInfo.isAvailable) {
		return null;
	}

	// iOS implementation with full features
	return (
		<Modal
			visible={visible}
			transparent
			animationType="fade"
			statusBarTranslucent={true}
			presentationStyle="overFullScreen"
			supportedOrientations={[
				'portrait',
				'landscape',
				'landscape-left',
				'landscape-right',
			]}
		>
			<View style={styles.overlay}>
				<View
					style={[
						styles.popup,
						{
							backgroundColor: currentTheme.colors.darkBackground || '#1a1a1a',
							borderColor: currentTheme.colors.elevation2 || '#333333',
							marginTop: insets.top + 20,
							marginBottom: insets.bottom + 20,
						},
					]}
				>
					{/* Header */}
					<View style={styles.header}>
						<View
							style={[
								styles.iconContainer,
								{ backgroundColor: `${currentTheme.colors.primary}20` },
							]}
						>
							<MaterialIcons
								name="system-update"
								size={32}
								color={currentTheme.colors.primary}
							/>
						</View>
						<Text style={[styles.title, { color: currentTheme.colors.highEmphasis }]}>
							{t('update_popup.update_available')}
						</Text>
						<Text
							style={[styles.subtitle, { color: currentTheme.colors.mediumEmphasis }]}
						>
							{t('update_popup.new_version')}
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
							<Text
								style={[
									styles.infoLabel,
									{ color: currentTheme.colors.mediumEmphasis },
								]}
							>
								{t('update_popup.version')}
							</Text>
							<Text
								style={[styles.infoValue, { color: currentTheme.colors.highEmphasis }]}
								numberOfLines={3}
								ellipsizeMode="tail"
								selectable
							>
								{updateInfo.manifest?.id || 'Latest'}
							</Text>
						</View>

						{!!getReleaseNotes() && (
							<View style={styles.descriptionContainer}>
								<Text
									style={[
										styles.description,
										{ color: currentTheme.colors.mediumEmphasis },
									]}
								>
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
								isInstalling && styles.disabledButton,
							]}
							onPress={handleUpdateNow}
							disabled={isInstalling}
							activeOpacity={0.8}
						>
							{isInstalling ? (
								<>
									<MaterialIcons name="install-mobile" size={18} color="white" />
									<Text style={styles.buttonText}>{t('update_popup.installing')}</Text>
								</>
							) : (
								<>
									<MaterialIcons name="download" size={18} color="white" />
									<Text style={styles.buttonText}>{t('update_popup.update_now')}</Text>
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
									},
								]}
								onPress={handleUpdateLater}
								disabled={isInstalling}
								activeOpacity={0.7}
							>
								<Text
									style={[
										styles.secondaryButtonText,
										{ color: currentTheme.colors.mediumEmphasis },
									]}
								>
									{t('update_popup.later')}
								</Text>
							</TouchableOpacity>

							<TouchableOpacity
								style={[
									styles.button,
									styles.secondaryButton,
									{
										backgroundColor: currentTheme.colors.darkBackground || '#2a2a2a',
										borderColor: currentTheme.colors.elevation3 || '#444444',
									},
								]}
								onPress={handleDismiss}
								disabled={isInstalling}
								activeOpacity={0.7}
							>
								<Text
									style={[
										styles.secondaryButtonText,
										{ color: currentTheme.colors.mediumEmphasis },
									]}
								>
									{t('update_popup.dismiss')}
								</Text>
							</TouchableOpacity>
						</View>
					</View>
				</View>
			</View>
		</Modal>
	);
};

const styles = StyleSheet.create({
	overlay: {
		flex: 1,
		backgroundColor: 'rgba(0, 0, 0, 0.8)',
		justifyContent: 'center',
		alignItems: 'center',
		paddingHorizontal: 20,
	},
	popup: {
		width: Math.min(width - 40, 400),
		borderRadius: 20,
		borderWidth: 1,
		backgroundColor: '#1a1a1a', // Solid background - not transparent
		...(Platform.OS === 'ios'
			? {
					shadowColor: '#000',
					shadowOffset: { width: 0, height: 10 },
					shadowOpacity: 0.5,
					shadowRadius: 20,
				}
			: {
					elevation: 15,
				}),
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
		...(Platform.OS === 'ios'
			? {
					shadowColor: '#000',
					shadowOffset: { width: 0, height: 4 },
					shadowOpacity: 0.2,
					shadowRadius: 8,
				}
			: {
					elevation: 4,
				}),
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
	footer: {
		paddingHorizontal: 24,
		paddingBottom: 24,
		alignItems: 'center',
	},
	footerText: {
		fontSize: 12,
		textAlign: 'center',
		opacity: 0.7,
	},
});

export default UpdatePopup;
