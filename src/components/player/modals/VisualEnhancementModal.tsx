import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions, StyleSheet, ScrollView } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '../../../contexts/ThemeContext';
import { shaderService, ShaderMode, SHADER_PROFILES, ShaderCategory } from '../../../services/shaderService';
import { visualEnhancementService, COLOR_PROFILES, PROFILE_DESCRIPTIONS, VideoSettings } from '../../../services/colorProfileService';
import { useSettings } from '../../../hooks/useSettings';
import Slider from '@react-native-community/slider';

interface VisualEnhancementModalProps {
  visible: boolean;
  onClose: () => void;
  // Shader props
  shaderMode: ShaderMode;
  setShaderMode: (mode: ShaderMode) => void;
  // Color props
  activeProfile: string;
  setProfile: (profile: string) => void;
  customSettings: VideoSettings;
  updateCustomSettings: (settings: Partial<VideoSettings>) => void;
}

const TabButton = ({ label, icon, isSelected, onPress }: any) => {
  const { currentTheme } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', opacity: isSelected ? 1 : 0.5 }}>
        <Ionicons name={icon} size={18} color="white" style={{ marginRight: 6 }} />
        <Text style={{ color: 'white', fontWeight: '700', fontSize: 14 }}>{label}</Text>
      </View>
      {isSelected && (
        <View style={{ 
          height: 3, 
          backgroundColor: currentTheme.colors.primary, 
          width: '60%', 
          borderRadius: 2,
          position: 'absolute',
          bottom: 0 
        }} />
      )}
    </TouchableOpacity>
  );
};

const ShaderTab = ({ currentMode, setMode }: { currentMode: string, setMode: (m: string) => void }) => {
  const { settings } = useSettings();
  const selectedCategory = (settings?.shaderProfile || 'MID-END') as ShaderCategory;
  
  const animeModes = SHADER_PROFILES[selectedCategory] ? Object.keys(SHADER_PROFILES[selectedCategory]) : [];
  const cinemaModes = SHADER_PROFILES['CINEMA'] ? Object.keys(SHADER_PROFILES['CINEMA']) : [];

  const getModeDescription = (name: string) => {
    if (name.includes('Mode A')) return 'Best for high-quality sources.';
    if (name.includes('Mode B')) return 'Soft restore for noisy videos.';
    if (name.includes('Mode C')) return 'Balanced restore and upscale.';
    if (name.includes('FSR')) return 'Sharp upscaling for live-action.';
    if (name.includes('SSimSuperRes')) return 'Natural sharpness and anti-ringing.';
    return '';
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
      <View style={styles.sectionHeader}>
        <Ionicons name="options-outline" size={16} color="rgba(255,255,255,0.4)" style={{ marginRight: 8 }} />
        <Text style={styles.sectionTitle}>GENERAL</Text>
      </View>
      
      <PresetItem
        label="None (Standard)"
        description="Native source resolution"
        isSelected={currentMode === 'none'}
        onPress={() => setMode('none')}
      />

      <View style={styles.sectionHeader}>
        <Ionicons name="color-palette-outline" size={16} color="rgba(255,255,255,0.4)" style={{ marginRight: 8 }} />
        <Text style={styles.sectionTitle}>ANIME (ANIME4K)</Text>
      </View>
      
      {animeModes.map((mode) => (
        <PresetItem
          key={mode}
          label={mode}
          description={getModeDescription(mode)}
          isSelected={currentMode === mode}
          onPress={() => setMode(mode)}
          isHQ={selectedCategory === 'HIGH-END'}
        />
      ))}

      {cinemaModes.length > 0 && (
        <>
          <View style={styles.sectionHeader}>
            <Ionicons name="film-outline" size={16} color="rgba(255,255,255,0.4)" style={{ marginRight: 8 }} />
            <Text style={styles.sectionTitle}>CINEMA</Text>
          </View>

          {cinemaModes.map((mode) => (
            <PresetItem
              key={mode}
              label={mode}
              description={getModeDescription(mode)}
              isSelected={currentMode === mode}
              onPress={() => setMode(mode)}
            />
          ))}
        </>
      )}
    </ScrollView>
  );
};

const PresetsTab = ({ activeProfile, setProfile }: { activeProfile: string, setProfile: (p: string) => void }) => {
  const groups = {
    'Anime': ['anime_4k', 'anime', 'anime_vibrant', 'anime_soft'],
    'Cinema': ['cinema', 'cinema_dark', 'cinema_hdr'],
    'Vivid': ['vivid', 'vivid_pop', 'vivid_warm'],
    'Other': ['natural', 'dark', 'warm', 'cool', 'grayscale'],
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
      {Object.entries(groups).map(([group, profiles]) => (
        <View key={group}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{group.toUpperCase()}</Text>
          </View>
          {profiles.map(profile => (
            <PresetItem
              key={profile}
              label={profile.replace(/_/g, ' ').toUpperCase()}
              description={PROFILE_DESCRIPTIONS[profile]}
              isSelected={activeProfile === profile}
              onPress={() => setProfile(profile)}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  );
};

const CustomTab = ({ settings, updateSettings, onReset }: any) => {
  const { currentTheme } = useTheme();
  const sliders = [
    { key: 'brightness', label: 'Brightness', min: -100, max: 100 },
    { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
    { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
    { key: 'gamma', label: 'Gamma', min: -100, max: 100 },
    { key: 'hue', label: 'Hue', min: -100, max: 100 },
  ];

  return (
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>
      <View style={{ padding: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, marginBottom: 20 }}>
        <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13, textAlign: 'center' }}>
          Fine-tune video properties. Changes are applied immediately.
        </Text>
      </View>

      {sliders.map(({ key, label, min, max }) => (
        <View key={key} style={{ marginBottom: 24 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
            <Text style={{ color: 'white', fontWeight: '600' }}>{label}</Text>
            <View style={{ backgroundColor: currentTheme.colors.primary, paddingHorizontal: 8, borderRadius: 4 }}>
              <Text style={{ color: 'black', fontWeight: 'bold', fontSize: 12 }}>{settings[key]}</Text>
            </View>
          </View>
          <Slider
            style={{ width: '100%', height: 40 }}
            minimumValue={min}
            maximumValue={max}
            step={1}
            value={settings[key]}
            onValueChange={(val) => updateSettings({ [key]: val })}
            minimumTrackTintColor={currentTheme.colors.primary}
            maximumTrackTintColor="rgba(255,255,255,0.2)"
            thumbTintColor="white"
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{min}</Text>
            <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10 }}>{max}</Text>
          </View>
        </View>
      ))}

      <TouchableOpacity 
        onPress={onReset}
        style={{ 
          backgroundColor: 'rgba(255,255,255,0.1)', 
          padding: 16, 
          borderRadius: 12,
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          marginTop: 10
        }}
      >
        <Ionicons name="refresh" size={20} color="white" style={{ marginRight: 8 }} />
        <Text style={{ color: 'white', fontWeight: '700' }}>Reset to Default</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};

const PresetItem = ({ label, description, isSelected, onPress, isHQ }: any) => {
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{ marginBottom: 8 }}>
      <View style={{ 
        padding: 16, 
        backgroundColor: isSelected ? 'white' : 'rgba(255,255,255,0.05)',
        borderRadius: 12,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={{ 
              color: isSelected ? 'black' : 'white', 
              fontWeight: '700', 
              fontSize: 15,
              marginBottom: 4
            }}>
              {label}
            </Text>
            {isHQ && (
              <View style={{ backgroundColor: '#FFD700', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, marginLeft: 8 }}>
                <Text style={{ color: 'black', fontSize: 9, fontWeight: '900' }}>HQ</Text>
              </View>
            )}
          </View>
          {description && (
            <Text style={{ 
              color: isSelected ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.5)', 
              fontSize: 12 
            }}>
              {description}
            </Text>
          )}
        </View>
        {isSelected && (
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: 'black' }} />
        )}
      </View>
    </TouchableOpacity>
  );
};

const VisualEnhancementModal: React.FC<VisualEnhancementModalProps> = ({
  visible,
  onClose,
  shaderMode,
  setShaderMode,
  activeProfile,
  setProfile,
  customSettings,
  updateCustomSettings,
}) => {
  const { height, width } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<'shaders' | 'presets' | 'custom'>('shaders');

  if (!visible) return null;

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 9999 }]}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose}>
        <Animated.View entering={FadeIn} exiting={FadeOut} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' }} />
      </TouchableOpacity>

      <View pointerEvents="box-none" style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' }}>
        <Animated.View
          entering={SlideInDown}
          exiting={SlideOutDown}
          style={{
            width: Math.min(width * 0.9, 450),
            height: height * 0.85,
            backgroundColor: '#121212',
            borderRadius: 24,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* Header */}
          <View style={{ padding: 20, paddingBottom: 0 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <Text style={{ color: 'white', fontSize: 20, fontWeight: '800' }}>Filters & Appearance</Text>
              <TouchableOpacity onPress={onClose} style={{ padding: 4 }}>
                <Ionicons name="close" size={24} color="rgba(255,255,255,0.5)" />
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={{ flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, padding: 4 }}>
              <TabButton 
                label="Upscalers" 
                icon="eye-outline" 
                isSelected={activeTab === 'shaders'} 
                onPress={() => setActiveTab('shaders')} 
              />
              <TabButton 
                label="Profiles" 
                icon="color-filter-outline" 
                isSelected={activeTab === 'presets'} 
                onPress={() => setActiveTab('presets')} 
              />
              <TabButton 
                label="Custom" 
                icon="options-outline" 
                isSelected={activeTab === 'custom'} 
                onPress={() => setActiveTab('custom')} 
              />
            </View>
          </View>

          {/* Content */}
          <View style={{ flex: 1, padding: 20 }}>
            {activeTab === 'shaders' && (
              <ShaderTab currentMode={shaderMode} setMode={setShaderMode} />
            )}
            {activeTab === 'presets' && (
              <PresetsTab activeProfile={activeProfile} setProfile={setProfile} />
            )}
            {activeTab === 'custom' && (
              <CustomTab 
                settings={customSettings} 
                updateSettings={updateCustomSettings} 
                onReset={() => setProfile('natural')}
              />
            )}
          </View>
        </Animated.View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    marginBottom: 12,
    marginLeft: 4,
  },
  sectionTitle: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});

export default VisualEnhancementModal;
