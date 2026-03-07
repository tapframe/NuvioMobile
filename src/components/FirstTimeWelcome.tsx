import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '../contexts/ThemeContext';
import { NavigationProp, useNavigation } from '@react-navigation/native';
import { RootStackParamList } from '../navigation/AppNavigator';
import i18n from '../i18n';

const { width } = Dimensions.get('window');

const FirstTimeWelcome = () => {
  const { currentTheme } = useTheme();
  const navigation = useNavigation<NavigationProp<RootStackParamList>>();

  return (
    <Animated.View 
      entering={FadeInDown.delay(200).duration(600)}
      style={[styles.container, { backgroundColor: currentTheme.colors.elevation1 }]}
    >
      <LinearGradient
        colors={[currentTheme.colors.primary, currentTheme.colors.secondary]}
        style={styles.iconContainer}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <MaterialIcons name="explore" size={40} color="white" />
      </LinearGradient>

      <Text style={[styles.title, { color: currentTheme.colors.highEmphasis }]}>
        Welcome to Nuvio!
      </Text>
      
      <Text style={[styles.description, { color: currentTheme.colors.mediumEmphasis }]}>
        To get started, install some addons to access content from various sources.
      </Text>

      <TouchableOpacity
        style={[styles.button, { backgroundColor: currentTheme.colors.primary }]}
        onPress={() => navigation.navigate('Addons')}
      >
        <MaterialIcons name="extension" size={20} color="white" />
        <Text style={styles.buttonText}>{i18n.t('components.install_addons')}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    margin: 16,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 8,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
    maxWidth: width * 0.7,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    gap: 8,
  },
  buttonText: {
    color: 'white',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default FirstTimeWelcome; 