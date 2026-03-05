import React, { useState, useEffect } from 'react';
import {
	View,
	Text,
	StyleSheet,
	ScrollView,
	SafeAreaView,
	StatusBar,
	TextInput,
	TouchableOpacity,
	Linking,
	Platform,
	Dimensions,
	Switch,
} from 'react-native';
import CustomAlert from '../components/CustomAlert';
import { mmkvStorage } from '../services/mmkvStorage';
import { useNavigation } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettings } from '../hooks/useSettings';
import { SvgXml } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

const { width } = Dimensions.get('window');
const isTablet = width >= 768;
const DEFAULT_OPENROUTER_MODEL = 'openrouter/free';

const AISettingsScreen: React.FC = () => {
	const { t } = useTranslation();
	// CustomAlert state (must be inside the component)
	const [alertVisible, setAlertVisible] = useState(false);
	const [alertTitle, setAlertTitle] = useState('');
	const [alertMessage, setAlertMessage] = useState('');
	const [alertActions, setAlertActions] = useState<
		Array<{ label: string; onPress: () => void; style?: object }>
	>([{ label: 'OK', onPress: () => setAlertVisible(false) }]);

	const openAlert = (
		title: string,
		message: string,
		actions?: Array<{ label: string; onPress?: () => void; style?: object }>,
	) => {
		setAlertTitle(title);
		setAlertMessage(message);
		if (actions && actions.length > 0) {
			setAlertActions(
				actions.map((a) => ({
					label: a.label,
					style: a.style,
					onPress: () => {
						a.onPress?.();
					},
				})),
			);
		} else {
			setAlertActions([{ label: 'OK', onPress: () => setAlertVisible(false) }]);
		}
		setAlertVisible(true);
	};
	const navigation = useNavigation();
	const { currentTheme } = useTheme();
	const insets = useSafeAreaInsets();
	const { settings, updateSetting } = useSettings();
	const OPENROUTER_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="400" viewBox="0 0 1200 400">
  <title>OpenRouter</title>
  <path fill="CURRENTCOLOR" d="M431.4 196.2c0 11.2-2.1 20.8-6.2 28.8a45 45 0 0 1-41 25 44.8 44.8 0 0 1-41-25c-4.2-8-6.2-17.7-6.2-28.8 0-11.2 2-20.8 6.1-28.8a44.9 44.9 0 0 1 41.1-25 45 45 0 0 1 41 25c4.1 8 6.2 17.6 6.2 28.8m-15.7 0c0-8.5-1.4-15.7-4.1-21.6a30.6 30.6 0 0 0-11.3-13.3c-4.7-3-10.1-4.5-16.1-4.5a30 30 0 0 0-16.2 4.5c-4.7 3-8.4 7.5-11.2 13.3-2.7 5.9-4.1 13-4.1 21.6 0 8.5 1.4 15.7 4.1 21.5A30.7 30.7 0 0 0 368 231c4.8 3 10.2 4.6 16.2 4.6s11.4-1.5 16.1-4.6c4.8-3 8.5-7.4 11.3-13.3 2.7-5.8 4.1-13 4.1-21.5Zm34 81.8V170h15v12.7h1.3c.9-1.6 2.1-3.5 3.8-5.6a22 22 0 0 1 18.7-8.1 30.6 30.6 0 0 1 28.7 18.6c2.9 6 4.3 13.3 4.3 21.8s-1.4 15.8-4.2 21.8a33 33 0 0 1-11.7 14 30 30 0 0 1-17 4.9c-4.7 0-8.6-.8-11.6-2.4a22 22 0 0 1-7.1-5.6c-1.7-2.2-3-4.1-4-5.8h-.8V278h-15.3m15-68.7c0 5.5.7 10.3 2.3 14.5 1.6 4.2 4 7.4 7 9.7 3 2.4 6.7 3.5 11.1 3.5 4.6 0 8.4-1.2 11.5-3.6 3-2.5 5.4-5.8 7-10 1.6-4.2 2.4-8.9 2.4-14.1 0-5.2-.8-9.9-2.4-14a21.7 21.7 0 0 0-7-9.7 18 18 0 0 0-11.5-3.6c-4.4 0-8.1 1.1-11.2 3.4-3 2.3-5.3 5.5-7 9.6a40 40 0 0 0-2.3 14.3ZM572.4 250c-7.8 0-14.4-1.6-20-5-5.6-3.3-9.9-8-12.9-14s-4.5-13.2-4.5-21.3c0-8 1.5-15.1 4.5-21.3a35 35 0 0 1 12.7-14.4 38.5 38.5 0 0 1 32-3 31.3 31.3 0 0 1 19 19.2c2 5 2.9 11 2.9 18.2v5.4h-62.5v-11.5h47.5c0-4-.8-7.6-2.5-10.7a18.6 18.6 0 0 0-17.2-10c-4.3 0-8 1-11.2 3a22.3 22.3 0 0 0-10 19.2v9c0 5.2 1 9.6 2.8 13.3 1.9 3.7 4.5 6.5 7.8 8.4a23 23 0 0 0 11.7 2.9c3 0 5.6-.4 8-1.3a16.4 16.4 0 0 0 10.2-10l14.4 2.7c-1.1 4.3-3.2 8-6.2 11.2-3 3.2-6.7 5.6-11.2 7.4a41.7 41.7 0 0 1-15.3 2.6Zm66-48.2v46.7h-15.3V170H638v12.8h1c1.8-4.2 4.6-7.5 8.5-10 3.8-2.6 8.7-3.8 14.6-3.8 5.4 0 10 1.1 14 3.3 4.1 2.3 7.2 5.6 9.4 10a36 36 0 0 1 3.4 16.3v50h-15.3v-48.2a19 19 0 0 0-4.5-13.3c-3-3.3-7-4.9-12.2-4.9a19 19 0 0 0-9.4 2.3 16.4 16.4 0 0 0-6.5 6.8 21.8 21.8 0 0 0-2.4 10.6Zm72 46.7V143.8h37.3c8 0 14.8 1.4 20.2 4.2 5.4 2.8 9.4 6.7 12 11.6a35 35 0 0 1 4 17c0 6.5-1.3 12.1-4 17a27.3 27.3 0 0 1-12 11.3c-5.4 2.7-12.2 4-20.3 4h-28.2v-13.6h26.8c5.1 0 9.3-.7 12.5-2.2 3.2-1.4 5.6-3.6 7-6.4a21 21 0 0 0 2.3-10c0-4-.7-7.4-2.2-10.3a15.2 15.2 0 0 0-7.1-6.7 29.3 29.3 0 0 0-12.7-2.3h-19.9v91.2h-15.7m51.7-47.3 25.8 47.3h-18l-25.3-47.3h17.5Zm73 48.8a34.1 34.1 0 0 1-32-19.2 47 47 0 0 1-4.6-21.3c0-8.1 1.5-15.2 4.5-21.3a34.1 34.1 0 0 1 32-19.3 34.1 34.1 0 0 1 32 19.3 45 45 0 0 1 4.7 21.3 47 47 0 0 1-4.6 21.3 34.1 34.1 0 0 1-32 19.2m0-12.8c4.8 0 8.8-1.3 11.9-3.8 3.1-2.5 5.4-5.9 7-10a42 42 0 0 0 2.2-14c0-5-.7-9.5-2.2-13.8a22.8 22.8 0 0 0-7-10.1 18.2 18.2 0 0 0-11.9-3.8c-4.8 0-8.8 1.2-12 3.8-3 2.6-5.4 6-7 10.2a40.5 40.5 0 0 0-2.2 13.8c0 5 .8 9.6 2.3 13.8 1.5 4.2 3.8 7.6 7 10.1 3.1 2.5 7.1 3.8 12 3.8ZM938.6 216v-46h15.3v78.6h-15v-13.7h-.8a24.4 24.4 0 0 1-23.5 14.7 26 26 0 0 1-13.4-3.4 23 23 0 0 1-9-10 36.3 36.3 0 0 1-3.4-16.2v-50h15.3v48.1a18 18 0 0 0 4.4 12.8c3 3.2 6.9 4.8 11.6 4.8a19 19 0 0 0 15.7-8.7c1.9-2.9 2.8-6.6 2.8-11Zm72.5-46v12.3h-43V170h43m-31.4-18.8H995v74.3c0 3 .4 5.2 1.3 6.7.9 1.4 2 2.5 3.5 3 1.4.5 3 .8 4.6.8a176.6 176.6 0 0 0 5.4-.7l2.7 12.6a27.2 27.2 0 0 1-10 1.7c-4 0-7.7-.7-11.2-2.2a19.3 19.3 0 0 1-8.4-7c-2.1-3-3.2-7-3.2-11.7v-77.5Zm82.1 99c-7.7 0-14.4-1.7-20-5-5.5-3.4-9.8-8-12.8-14.1-3-6-4.6-13.2-4.6-21.3a47 47 0 0 1 4.6-21.3c3-6.1 7.2-11 12.6-14.4a38.5 38.5 0 0 1 32-3 31.3 31.3 0 0 1 19 19.2c2 5 3 11 3 18.2v5.4H1033v-11.5h47.4c0-4-.8-7.6-2.4-10.7a18.7 18.7 0 0 0-17.3-10c-4.3 0-8 1-11.2 3a22.9 22.9 0 0 0-9.9 19.2v9c0 5.2.9 9.6 2.8 13.3 1.8 3.7 4.4 6.5 7.8 8.4a23 23 0 0 0 11.7 2.9 24 24 0 0 0 7.9-1.3 16.7 16.7 0 0 0 10.2-9.9l14.4 2.6a26 26 0 0 1-6.2 11.2 30 30 0 0 1-11.2 7.4 41.6 41.6 0 0 1-15.3 2.6Zm50.7-1.6V170h14.8v12.5h.8c1.5-4.2 4-7.6 7.6-10 3.7-2.5 7.8-3.7 12.4-3.7a68 68 0 0 1 6.5.4v14.6a31.9 31.9 0 0 0-8-1 20 20 0 0 0-9.6 2.4 17.2 17.2 0 0 0-9.2 15.4v48h-15.3Z"/>
  <g fill="CURRENTCOLOR" stroke="CURRENTCOLOR">
    <path stroke-width="35.3" d="M46.2 200.5c5.9 0 28.6-5.1 40.3-11.8 11.8-6.6 11.8-6.6 36.1-23.9 30.8-21.8 52.5-14.5 88.2-14.5"/>
    <path stroke-width=".4" d="M245.3 150.5 185 185.3v-69.6l60.3 34.8Z"/>
    <path stroke-width="35.3" d="M45 200.5c5.9 0 28.6 5 40.4 11.7 11.7 6.7 11.7 6.7 36 24 30.8 21.8 52.5 14.5 88.2 14.5"/>
    <path stroke-width=".4" d="m244.1 250.4-60.3-34.7v69.5l60.3-34.8Z"/>
  </g>
</svg>`;

	const [apiKey, setApiKey] = useState('');
	const [loading, setLoading] = useState(false);
	const [isKeySet, setIsKeySet] = useState(false);
	const [useDefaultModel, setUseDefaultModel] = useState(true);
	const [customModel, setCustomModel] = useState('');

	useEffect(() => {
		loadApiKey();
	}, []);

	const loadApiKey = async () => {
		try {
			const [savedKey, savedModel] = await Promise.all([
				mmkvStorage.getItem('openrouter_api_key'),
				mmkvStorage.getItem('openrouter_model'),
			]);
			if (savedKey) {
				setApiKey(savedKey);
				setIsKeySet(true);
			}
			if (savedModel && savedModel.trim()) {
				setUseDefaultModel(false);
				setCustomModel(savedModel.trim());
			} else {
				setUseDefaultModel(true);
				setCustomModel('');
			}
		} catch (error) {
			if (__DEV__) console.error('Error loading OpenRouter API key:', error);
		}
	};

	const handleSaveApiKey = async () => {
		if (!apiKey.trim()) {
			openAlert(t('common.error'), t('ai_settings.error_invalid_key'));
			return;
		}

		if (!apiKey.startsWith('sk-or-')) {
			openAlert(t('common.error'), t('ai_settings.error_key_format'));
			return;
		}

		setLoading(true);
		try {
			await mmkvStorage.setItem('openrouter_api_key', apiKey.trim());
			if (useDefaultModel || !customModel.trim()) {
				await mmkvStorage.removeItem('openrouter_model');
			} else {
				await mmkvStorage.setItem('openrouter_model', customModel.trim());
			}
			setIsKeySet(true);
			openAlert(t('common.success'), t('ai_settings.success_saved'));
		} catch (error) {
			openAlert(t('common.error'), t('ai_settings.error_save'));
			if (__DEV__) console.error('Error saving OpenRouter API key:', error);
		} finally {
			setLoading(false);
		}
	};

	const handleRemoveApiKey = () => {
		openAlert(
			t('ai_settings.confirm_remove_title'),
			t('ai_settings.confirm_remove_msg'),
			[
				{ label: t('common.cancel'), onPress: () => {} },
				{
					label: t('common.remove'),
					onPress: async () => {
						try {
							await mmkvStorage.removeItem('openrouter_api_key');
							setApiKey('');
							setIsKeySet(false);
							openAlert(t('common.success'), t('ai_settings.success_removed'));
						} catch (error) {
							openAlert(t('common.error'), t('ai_settings.error_remove'));
						}
					},
				},
			],
		);
	};

	const handleGetApiKey = () => {
		Linking.openURL('https://openrouter.ai/keys');
	};

	return (
		<SafeAreaView
			style={[
				styles.container,
				{ backgroundColor: currentTheme.colors.darkBackground },
			]}
		>
			<StatusBar barStyle="light-content" />

			{/* Header */}
			<View style={styles.header}>
				<TouchableOpacity
					onPress={() => navigation.goBack()}
					style={styles.backButton}
				>
					<MaterialIcons
						name="arrow-back"
						size={24}
						color={currentTheme.colors.text}
					/>
					<Text style={[styles.backText, { color: currentTheme.colors.text }]}>
						{t('settings.settings_title')}
					</Text>
				</TouchableOpacity>

				<View style={styles.headerActions}>
					{/* Empty for now, but ready for future actions */}
				</View>
			</View>

			<Text style={[styles.headerTitle, { color: currentTheme.colors.text }]}>
				{t('ai_settings.title')}
			</Text>

			<ScrollView
				style={styles.scrollView}
				contentContainerStyle={styles.scrollContent}
				showsVerticalScrollIndicator={false}
			>
				{/* Info Card */}
				<View
					style={[
						styles.infoCard,
						{ backgroundColor: currentTheme.colors.elevation1 },
					]}
				>
					<View style={styles.infoHeader}>
						<MaterialIcons
							name="smart-toy"
							size={24}
							color={currentTheme.colors.primary}
						/>
						<Text
							style={[styles.infoTitle, { color: currentTheme.colors.highEmphasis }]}
						>
							{t('ai_settings.info_title')}
						</Text>
					</View>
					<Text
						style={[
							styles.infoDescription,
							{ color: currentTheme.colors.mediumEmphasis },
						]}
					>
						{t('ai_settings.info_desc')}
					</Text>

					<View style={styles.featureList}>
						<View style={styles.featureItem}>
							<MaterialIcons
								name="check-circle"
								size={16}
								color={currentTheme.colors.primary}
							/>
							<Text
								style={[
									styles.featureText,
									{ color: currentTheme.colors.mediumEmphasis },
								]}
							>
								{t('ai_settings.feature_1')}
							</Text>
						</View>
						<View style={styles.featureItem}>
							<MaterialIcons
								name="check-circle"
								size={16}
								color={currentTheme.colors.primary}
							/>
							<Text
								style={[
									styles.featureText,
									{ color: currentTheme.colors.mediumEmphasis },
								]}
							>
								{t('ai_settings.feature_2')}
							</Text>
						</View>
						<View style={styles.featureItem}>
							<MaterialIcons
								name="check-circle"
								size={16}
								color={currentTheme.colors.primary}
							/>
							<Text
								style={[
									styles.featureText,
									{ color: currentTheme.colors.mediumEmphasis },
								]}
							>
								{t('ai_settings.feature_3')}
							</Text>
						</View>
						<View style={styles.featureItem}>
							<MaterialIcons
								name="check-circle"
								size={16}
								color={currentTheme.colors.primary}
							/>
							<Text
								style={[
									styles.featureText,
									{ color: currentTheme.colors.mediumEmphasis },
								]}
							>
								{t('ai_settings.feature_4')}
							</Text>
						</View>
					</View>
				</View>

				{/* API Key Configuration */}
				<View
					style={[styles.card, { backgroundColor: currentTheme.colors.elevation1 }]}
				>
					<Text
						style={[styles.cardTitle, { color: currentTheme.colors.mediumEmphasis }]}
					>
						{t('ai_settings.api_key_section')}
					</Text>

					<View style={styles.apiKeySection}>
						<Text style={[styles.label, { color: currentTheme.colors.highEmphasis }]}>
							{t('ai_settings.api_key_label')}
						</Text>
						<Text
							style={[
								styles.description,
								{ color: currentTheme.colors.mediumEmphasis },
							]}
						>
							{t('ai_settings.api_key_desc')}
						</Text>

						<TextInput
							style={[
								styles.input,
								{
									backgroundColor: currentTheme.colors.elevation2,
									color: currentTheme.colors.highEmphasis,
									borderColor: currentTheme.colors.elevation2,
								},
							]}
							value={apiKey}
							onChangeText={setApiKey}
							placeholder="sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx"
							placeholderTextColor={currentTheme.colors.mediumEmphasis}
							secureTextEntry={true}
							autoCapitalize="none"
							autoCorrect={false}
						/>

						<View style={styles.modelSection}>
							<View style={styles.modelHeader}>
								<Text
									style={[styles.label, { color: currentTheme.colors.highEmphasis }]}
								>
									{t('ai_settings.model')}
								</Text>
								<Switch
									value={useDefaultModel}
									onValueChange={setUseDefaultModel}
									trackColor={{
										false: currentTheme.colors.elevation2,
										true: currentTheme.colors.primary,
									}}
									thumbColor={
										useDefaultModel
											? currentTheme.colors.white
											: currentTheme.colors.mediumEmphasis
									}
									ios_backgroundColor={currentTheme.colors.elevation2}
								/>
							</View>
							<Text
								style={[
									styles.description,
									{ color: currentTheme.colors.mediumEmphasis },
								]}
							>
								{useDefaultModel
									? `${t('ai_settings.using')} ${DEFAULT_OPENROUTER_MODEL} (free automatic routing).`
									: t('ai_settings.paid_routing')}
							</Text>
							{!useDefaultModel && (
								<TextInput
									style={[
										styles.input,
										{
											backgroundColor: currentTheme.colors.elevation2,
											color: currentTheme.colors.highEmphasis,
											borderColor: currentTheme.colors.elevation2,
										},
									]}
									value={customModel}
									onChangeText={setCustomModel}
									placeholder="e.g. openai/gpt-4o-mini"
									placeholderTextColor={currentTheme.colors.mediumEmphasis}
									autoCapitalize="none"
									autoCorrect={false}
								/>
							)}
						</View>

						<View style={styles.buttonContainer}>
							{!isKeySet ? (
								<TouchableOpacity
									style={[
										styles.saveButton,
										{ backgroundColor: currentTheme.colors.primary },
									]}
									onPress={handleSaveApiKey}
									disabled={loading}
								>
									<MaterialIcons
										name="save"
										size={20}
										color={currentTheme.colors.white}
										style={{ marginRight: 8 }}
									/>
									<Text style={styles.saveButtonText}>
										{loading ? t('ai_settings.saving') : t('ai_settings.save_api_key')}
									</Text>
								</TouchableOpacity>
							) : (
								<View style={styles.buttonRow}>
									<TouchableOpacity
										style={[
											styles.updateButton,
											{ backgroundColor: currentTheme.colors.primary },
										]}
										onPress={handleSaveApiKey}
										disabled={loading}
									>
										<MaterialIcons
											name="update"
											size={20}
											color={currentTheme.colors.white}
											style={{ marginRight: 8 }}
										/>
										<Text style={styles.updateButtonText}>{t('ai_settings.update')}</Text>
									</TouchableOpacity>

									<TouchableOpacity
										style={[
											styles.removeButton,
											{ borderColor: currentTheme.colors.error },
										]}
										onPress={handleRemoveApiKey}
									>
										<MaterialIcons
											name="delete"
											size={20}
											color={currentTheme.colors.error}
											style={{ marginRight: 8 }}
										/>
										<Text
											style={[
												styles.removeButtonText,
												{ color: currentTheme.colors.error },
											]}
										>
											{t('ai_settings.remove')}
										</Text>
									</TouchableOpacity>
								</View>
							)}
						</View>

						<TouchableOpacity
							style={[
								styles.getKeyButton,
								{ backgroundColor: currentTheme.colors.elevation2 },
							]}
							onPress={handleGetApiKey}
						>
							<MaterialIcons
								name="open-in-new"
								size={20}
								color={currentTheme.colors.primary}
								style={{ marginRight: 8 }}
							/>
							<Text
								style={[
									styles.getKeyButtonText,
									{ color: currentTheme.colors.primary },
								]}
							>
								{t('ai_settings.get_free_key')}
							</Text>
						</TouchableOpacity>
					</View>
				</View>

				{/* Enable Toggle (top) */}
				<View
					style={[styles.card, { backgroundColor: currentTheme.colors.elevation1 }]}
				>
					<View
						style={{
							flexDirection: 'row',
							alignItems: 'center',
							justifyContent: 'space-between',
						}}
					>
						<Text style={[styles.label, { color: currentTheme.colors.highEmphasis }]}>
							{t('ai_settings.enable_chat')}
						</Text>
						<Switch
							value={!!settings.aiChatEnabled}
							onValueChange={(v) => updateSetting('aiChatEnabled', v)}
							trackColor={{
								false: currentTheme.colors.elevation2,
								true: currentTheme.colors.primary,
							}}
							thumbColor={
								settings.aiChatEnabled
									? currentTheme.colors.white
									: currentTheme.colors.mediumEmphasis
							}
							ios_backgroundColor={currentTheme.colors.elevation2}
						/>
					</View>
					<Text
						style={[
							styles.description,
							{ color: currentTheme.colors.mediumEmphasis, marginTop: 8 },
						]}
					>
						{t('ai_settings.enable_chat_desc')}
					</Text>
				</View>

				{/* Status Card */}
				{isKeySet && (
					<View
						style={[
							styles.statusCard,
							{ backgroundColor: currentTheme.colors.elevation1 },
						]}
					>
						<View style={styles.statusHeader}>
							<MaterialIcons
								name="check-circle"
								size={24}
								color={currentTheme.colors.success || '#4CAF50'}
							/>
							<Text
								style={[
									styles.statusTitle,
									{ color: currentTheme.colors.success || '#4CAF50' },
								]}
							>
								{t('ai_settings.chat_enabled')}
							</Text>
						</View>
						<Text
							style={[
								styles.statusDescription,
								{ color: currentTheme.colors.mediumEmphasis },
							]}
						>
							{t('ai_settings.chat_enabled_desc')}
						</Text>
					</View>
				)}

				{/* Usage Info */}
				<View
					style={[
						styles.usageCard,
						{ backgroundColor: currentTheme.colors.elevation1 },
					]}
				>
					<Text
						style={[styles.usageTitle, { color: currentTheme.colors.highEmphasis }]}
					>
						{t('ai_settings.how_it_works')}
					</Text>
					<Text
						style={[styles.usageText, { color: currentTheme.colors.mediumEmphasis }]}
					>
						{t('ai_settings.how_it_works_desc')}
					</Text>
				</View>
				{/* OpenRouter branding */}
				<View style={{ alignItems: 'center', marginTop: 16, marginBottom: 32 }}>
					<SvgXml
						xml={OPENROUTER_SVG.replace(
							/CURRENTCOLOR/g,
							currentTheme.colors.mediumEmphasis,
						)}
						width={180}
						height={60}
					/>
				</View>
			</ScrollView>
			<CustomAlert
				visible={alertVisible}
				title={alertTitle}
				message={alertMessage}
				onClose={() => setAlertVisible(false)}
				actions={alertActions}
			/>
		</SafeAreaView>
	);
};

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	header: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
		paddingHorizontal: 16,
		paddingTop:
			Platform.OS === 'android' ? (StatusBar.currentHeight || 0) + 8 : 8,
	},
	backButton: {
		flexDirection: 'row',
		alignItems: 'center',
		padding: 8,
	},
	backText: {
		fontSize: 17,
		marginLeft: 8,
	},
	headerActions: {
		flexDirection: 'row',
		alignItems: 'center',
	},
	headerButton: {
		padding: 8,
		marginLeft: 8,
	},
	headerTitle: {
		fontSize: 34,
		fontWeight: 'bold',
		paddingHorizontal: 20,
		marginBottom: 24,
	},
	scrollView: {
		flex: 1,
	},
	scrollContent: {
		paddingBottom: 40,
	},
	infoCard: {
		borderRadius: 16,
		padding: 20,
		marginHorizontal: 16,
		marginBottom: 20,
	},
	infoHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		marginBottom: 12,
	},
	infoTitle: {
		fontSize: 20,
		fontWeight: '700',
		marginLeft: 12,
	},
	infoDescription: {
		fontSize: 16,
		lineHeight: 24,
		marginBottom: 16,
	},
	featureList: {
		gap: 8,
	},
	featureItem: {
		flexDirection: 'row',
		alignItems: 'center',
	},
	featureText: {
		fontSize: 15,
		marginLeft: 8,
		flex: 1,
	},
	card: {
		borderRadius: 16,
		padding: 20,
		marginHorizontal: 16,
		marginBottom: 20,
	},
	cardTitle: {
		fontSize: 13,
		fontWeight: '600',
		letterSpacing: 0.8,
		marginBottom: 16,
	},
	apiKeySection: {
		gap: 12,
	},
	modelSection: {
		gap: 8,
		marginTop: 4,
	},
	modelHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'space-between',
	},
	label: {
		fontSize: 16,
		fontWeight: '600',
	},
	description: {
		fontSize: 14,
		lineHeight: 20,
	},
	input: {
		borderRadius: 12,
		padding: 16,
		fontSize: 16,
		fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
		borderWidth: 1,
	},
	buttonContainer: {
		marginTop: 8,
	},
	buttonRow: {
		flexDirection: 'row',
		gap: 12,
	},
	saveButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 14,
		paddingHorizontal: 20,
		borderRadius: 12,
	},
	saveButtonText: {
		color: 'white',
		fontSize: 16,
		fontWeight: '600',
	},
	updateButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 14,
		paddingHorizontal: 20,
		borderRadius: 12,
		flex: 1,
	},
	updateButtonText: {
		color: 'white',
		fontSize: 16,
		fontWeight: '600',
	},
	removeButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 14,
		paddingHorizontal: 20,
		borderRadius: 12,
		borderWidth: 2,
		flex: 1,
	},
	removeButtonText: {
		fontSize: 16,
		fontWeight: '600',
	},
	getKeyButton: {
		flexDirection: 'row',
		alignItems: 'center',
		justifyContent: 'center',
		paddingVertical: 12,
		paddingHorizontal: 16,
		borderRadius: 12,
		marginTop: 8,
	},
	getKeyButtonText: {
		fontSize: 15,
		fontWeight: '500',
	},
	statusCard: {
		borderRadius: 16,
		padding: 20,
		marginBottom: 20,
	},
	statusHeader: {
		flexDirection: 'row',
		alignItems: 'center',
		marginBottom: 8,
	},
	statusTitle: {
		fontSize: 18,
		fontWeight: '600',
		marginLeft: 12,
	},
	statusDescription: {
		fontSize: 15,
		lineHeight: 22,
	},
	usageCard: {
		borderRadius: 16,
		padding: 20,
	},
	usageTitle: {
		fontSize: 18,
		fontWeight: '600',
		marginBottom: 12,
	},
	usageText: {
		fontSize: 15,
		lineHeight: 24,
	},
});

export default AISettingsScreen;
