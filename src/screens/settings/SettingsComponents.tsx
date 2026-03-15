import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Platform, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';

const { width } = Dimensions.get('window');
const isTablet = width >= 768;

// Card component with minimalistic style
interface SettingsCardProps {
    children: React.ReactNode;
    title?: string;
    isTablet?: boolean;
}

export const SettingsCard: React.FC<SettingsCardProps> = ({ children, title, isTablet: isTabletProp = false }) => {
    const { currentTheme } = useTheme();
    const useTabletStyle = isTabletProp || isTablet;

    return (
        <View
            style={[
                styles.cardContainer,
                useTabletStyle && styles.tabletCardContainer
            ]}
        >
            {title && (
                <Text style={[
                    styles.cardTitle,
                    { color: currentTheme.colors.mediumEmphasis },
                    useTabletStyle && styles.tabletCardTitle
                ]}>
                    {title}
                </Text>
            )}
            <View style={[
                styles.card,
                {
                    backgroundColor: currentTheme.colors.elevation1,
                    borderWidth: 1,
                    borderColor: currentTheme.colors.elevation2,
                },
                useTabletStyle && styles.tabletCard
            ]}>
                {children}
            </View>
        </View>
    );
};

interface SettingItemProps {
    title: string;
    description?: string;
    icon?: string;
    customIcon?: React.ReactNode;
    renderControl?: () => React.ReactNode;
    isLast?: boolean;
    onPress?: () => void;
    badge?: string | number;
    isTablet?: boolean;
    descriptionNumberOfLines?: number;
    disabled?: boolean;
}

export const SettingItem: React.FC<SettingItemProps> = ({
    title,
    description,
    icon,
    customIcon,
    renderControl,
    isLast = false,
    onPress,
    badge,
    isTablet: isTabletProp = false,
    descriptionNumberOfLines = 1,
    disabled = false
}) => {
    const { currentTheme } = useTheme();
    const useTabletStyle = isTabletProp || isTablet;

    return (
        <TouchableOpacity
            activeOpacity={disabled ? 1 : 0.6}
            onPress={disabled ? undefined : onPress}
            disabled={disabled}
            style={[
                styles.settingItem,
                !isLast && styles.settingItemBorder,
                { borderBottomColor: currentTheme.colors.elevation2 },
                useTabletStyle && styles.tabletSettingItem,
                disabled && { opacity: 0.4 }
            ]}
        >
            <View style={[
                styles.settingIconContainer,
                {
                    backgroundColor: currentTheme.colors.primary + '12',
                },
                useTabletStyle && styles.tabletSettingIconContainer
            ]}>
                {customIcon ? (
                    customIcon
                ) : (
                    <Feather
                        name={icon! as any}
                        size={useTabletStyle ? 22 : 18}
                        color={currentTheme.colors.primary}
                    />
                )}
            </View>
            <View style={styles.settingContent}>
                <View style={styles.settingTextContainer}>
                    <Text style={[
                        styles.settingTitle,
                        { color: currentTheme.colors.highEmphasis },
                        useTabletStyle && styles.tabletSettingTitle
                    ]}>
                        {title}
                    </Text>
                    {description && (
                        <Text style={[
                            styles.settingDescription,
                            { color: currentTheme.colors.mediumEmphasis },
                            useTabletStyle && styles.tabletSettingDescription
                        ]} numberOfLines={descriptionNumberOfLines}>
                            {description}
                        </Text>
                    )}
                </View>
                {badge && (
                    <View style={[styles.badge, { backgroundColor: `${currentTheme.colors.primary}20` }]}>
                        <Text style={[styles.badgeText, { color: currentTheme.colors.primary }]}>{String(badge)}</Text>
                    </View>
                )}
            </View>
            {renderControl && (
                <View style={styles.settingControl}>
                    {renderControl()}
                </View>
            )}
        </TouchableOpacity>
    );
};

// Custom Switch component
interface CustomSwitchProps {
    value: boolean;
    onValueChange: (value: boolean) => void;
}

export const CustomSwitch: React.FC<CustomSwitchProps> = ({ value, onValueChange }) => {
    const { currentTheme } = useTheme();

    return (
        <Switch
            value={value}
            onValueChange={onValueChange}
            trackColor={{ false: currentTheme.colors.elevation2, true: currentTheme.colors.primary }}
            thumbColor={value ? currentTheme.colors.white : currentTheme.colors.mediumEmphasis}
            ios_backgroundColor={currentTheme.colors.elevation2}
        />
    );
};

// Chevron Right component
export const ChevronRight: React.FC<{ isTablet?: boolean }> = ({ isTablet: isTabletProp = false }) => {
    const { currentTheme } = useTheme();
    const useTabletStyle = isTabletProp || isTablet;

    return (
        <Feather
            name="chevron-right"
            size={useTabletStyle ? 24 : 20}
            color={currentTheme.colors.mediumEmphasis}
        />
    );
};

const styles = StyleSheet.create({
    cardContainer: {
        marginBottom: 20,
        paddingHorizontal: 16,
    },
    tabletCardContainer: {
        marginBottom: 28,
        paddingHorizontal: 0,
    },
    cardTitle: {
        fontSize: 13,
        fontWeight: '600',
        marginBottom: 10,
        marginLeft: 4,
        letterSpacing: 0.8,
    },
    tabletCardTitle: {
        fontSize: 14,
        marginBottom: 12,
    },
    card: {
        borderRadius: 16,
        overflow: 'hidden',
    },
    tabletCard: {
        borderRadius: 20,
    },
    settingItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 14,
        paddingHorizontal: 16,
        minHeight: 60,
    },
    tabletSettingItem: {
        paddingVertical: 16,
        paddingHorizontal: 20,
        minHeight: 68,
    },
    settingItemBorder: {
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    settingIconContainer: {
        width: 36,
        height: 36,
        borderRadius: 10,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 14,
    },
    tabletSettingIconContainer: {
        width: 42,
        height: 42,
        borderRadius: 12,
        marginRight: 16,
    },
    settingContent: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    settingTextContainer: {
        flex: 1,
    },
    settingTitle: {
        fontSize: 16,
        fontWeight: '500',
        marginBottom: 2,
    },
    tabletSettingTitle: {
        fontSize: 17,
    },
    settingDescription: {
        fontSize: 13,
        marginTop: 2,
    },
    tabletSettingDescription: {
        fontSize: 14,
    },
    settingControl: {
        marginLeft: 12,
    },
    badge: {
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 10,
        marginLeft: 8,
    },
    badgeText: {
        fontSize: 12,
        fontWeight: '600',
    },
});

export default SettingsCard;
