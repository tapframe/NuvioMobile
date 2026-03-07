import React from 'react';
import {
    View,
    Text,
    StyleSheet,
    Animated as RNAnimated,
    Easing,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '../../contexts/ThemeContext';
import i18n from '../../i18n';

/**
 * Animated search indicator shown while searching
 */
export const SearchAnimation: React.FC = () => {
    const spinAnim = React.useRef(new RNAnimated.Value(0)).current;
    const fadeAnim = React.useRef(new RNAnimated.Value(0)).current;
    const { currentTheme } = useTheme();

    React.useEffect(() => {
        // Rotation animation
        const spin = RNAnimated.loop(
            RNAnimated.timing(spinAnim, {
                toValue: 1,
                duration: 1500,
                easing: Easing.linear,
                useNativeDriver: true,
            })
        );

        // Fade animation
        const fade = RNAnimated.timing(fadeAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
        });

        // Start animations
        spin.start();
        fade.start();

        // Clean up
        return () => {
            spin.stop();
        };
    }, [spinAnim, fadeAnim]);

    // Simple rotation interpolation
    const spin = spinAnim.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    return (
        <RNAnimated.View
            style={[
                styles.container,
                { opacity: fadeAnim }
            ]}
        >
            <View style={styles.content}>
                <RNAnimated.View style={[
                    styles.spinnerContainer,
                    { transform: [{ rotate: spin }], backgroundColor: currentTheme.colors.primary }
                ]}>
                    <MaterialIcons
                        name="search"
                        size={32}
                        color={currentTheme.colors.white}
                    />
                </RNAnimated.View>
                <Text style={[styles.text, { color: currentTheme.colors.white }]}>{i18n.t('components.searching')}</Text>
            </View>
        </RNAnimated.View>
    );
};

const styles = StyleSheet.create({
    container: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 10,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'rgba(0,0,0,0.7)',
    },
    content: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        borderRadius: 16,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    spinnerContainer: {
        width: 64,
        height: 64,
        borderRadius: 32,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 16,
    },
    text: {
        fontSize: 16,
        fontWeight: '600',
    },
});

export default SearchAnimation;
