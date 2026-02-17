import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions, StyleSheet, TextInput, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { useSettings } from '../../../hooks/useSettings';
import { introService, SkipType } from '../../../services/introService';
import { toastService } from '../../../services/toastService';

interface SubmitIntroModalProps {
  visible: boolean;
  onClose: () => void;
  currentTime: number;
  imdbId?: string;
  season?: number;
  episode?: number;
}

/**
 * Parses time string (MM:SS or SS) to seconds
 */
const parseTimeToSeconds = (input: string): number | null => {
  if (!input) return null;
  
  // Format: MM:SS
  if (input.includes(':')) {
    const parts = input.split(':');
    if (parts.length !== 2) return null;
    const mins = parseInt(parts[0], 10);
    const secs = parseInt(parts[1], 10);
    if (isNaN(mins) || isParseSecs(secs)) return null;
    return mins * 60 + secs;
  }
  
  // Format: Seconds only
  const secs = parseInt(input, 10);
  return isNaN(secs) ? null : secs;
};

const isParseSecs = (secs: number) => isNaN(secs) || secs < 0 || secs >= 60;

/**
 * Formats seconds to MM:SS
 */
const formatSecondsToMMSS = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const SubmitIntroModal: React.FC<SubmitIntroModalProps> = ({
  visible,
  onClose,
  currentTime,
  imdbId,
  season,
  episode,
}) => {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const { settings } = useSettings();
  
  const [startTimeStr, setStartTimeStr] = useState('00:00');
  const [endTimeStr, setEndTimeStr] = useState(formatSecondsToMMSS(currentTime));
  const [segmentType, setSegmentType] = useState<SkipType>('intro');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setEndTimeStr(formatSecondsToMMSS(currentTime));
    }
  }, [visible, currentTime]);

  if (!visible) return null;

  const handleCaptureStart = () => setStartTimeStr(formatSecondsToMMSS(currentTime));
  const handleCaptureEnd = () => setEndTimeStr(formatSecondsToMMSS(currentTime));

  const handleSubmit = async () => {
    const startSec = parseTimeToSeconds(startTimeStr);
    const endSec = parseTimeToSeconds(endTimeStr);

    if (startSec === null || endSec === null) {
      toastService.error('Invalid format', 'Please use MM:SS format');
      return;
    }

    if (endSec <= startSec) {
      toastService.warning('Invalid duration', 'End time must be after start time');
      return;
    }

    if (!imdbId || season === undefined || episode === undefined) {
      toastService.error('Missing metadata', 'Could not identify this episode');
      return;
    }

    setIsSubmitting(true);
    try {
      const success = await introService.submitIntro(
        settings.introDbApiKey,
        imdbId,
        season,
        episode,
        startSec,
        endSec,
        segmentType
      );

      if (success) {
        toastService.success(t('player_ui.intro_submitted', { defaultValue: 'Segment submitted successfully' }));
        onClose();
      } else {
        toastService.error(t('player_ui.intro_submit_failed', { defaultValue: 'Failed to submit segment' }));
      }
    } catch (error) {
      toastService.error('Error', 'An unexpected error occurred');
    } finally {
      setIsSubmitting(false);
    }
  };

  const segmentTypes: { label: string; value: SkipType; icon: any }[] = [
    { label: 'Intro', value: 'intro', icon: 'play-circle-outline' },
    { label: 'Recap', value: 'recap', icon: 'replay' },
    { label: 'Outro', value: 'outro', icon: 'stop-circle' },
  ];

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 10000 }]}>
      <TouchableOpacity
        style={StyleSheet.absoluteFill}
        activeOpacity={1}
        onPress={onClose}
      >
        <Animated.View entering={FadeIn} exiting={FadeOut} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' }} />
      </TouchableOpacity>

      <View pointerEvents="box-none" style={localStyles.centeredView}>
        <Animated.View
          entering={SlideInDown.duration(300)}
          exiting={SlideOutDown.duration(250)}
          style={[localStyles.modalContainer, { width: Math.min(width * 0.85, 380) }]}
        >
          <View style={localStyles.header}>
            <Text style={localStyles.title}>Submit Timestamps</Text>
            <TouchableOpacity onPress={onClose} style={localStyles.closeButton}>
              <Ionicons name="close" size={24} color="rgba(255,255,255,0.5)" />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={localStyles.content}>
            {/* Segment Type Selector */}
            <View>
              <Text style={localStyles.label}>Segment Type</Text>
              <View style={localStyles.typeRow}>
                {segmentTypes.map((type) => (
                  <TouchableOpacity
                    key={type.value}
                    onPress={() => setSegmentType(type.value)}
                    style={[
                      localStyles.typeButton,
                      segmentType === type.value && localStyles.typeButtonActive
                    ]}
                  >
                    <MaterialIcons 
                      name={type.icon} 
                      size={18} 
                      color={segmentType === type.value ? 'black' : 'rgba(255,255,255,0.6)'} 
                    />
                    <Text style={[
                      localStyles.typeButtonText,
                      segmentType === type.value && localStyles.typeButtonTextActive
                    ]}>
                      {type.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Start Time Input */}
            <View style={localStyles.inputRow}>
              <View style={{ flex: 1 }}>
                <Text style={localStyles.label}>Start Time (MM:SS)</Text>
                <TextInput
                  style={localStyles.input}
                  value={startTimeStr}
                  onChangeText={setStartTimeStr}
                  placeholder="00:00"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <TouchableOpacity onPress={handleCaptureStart} style={localStyles.captureBtn}>
                <MaterialIcons name="my-location" size={20} color="white" />
                <Text style={localStyles.captureText}>Capture</Text>
              </TouchableOpacity>
            </View>

            {/* End Time Input */}
            <View style={localStyles.inputRow}>
              <View style={{ flex: 1 }}>
                <Text style={localStyles.label}>End Time (MM:SS)</Text>
                <TextInput
                  style={localStyles.input}
                  value={endTimeStr}
                  onChangeText={setEndTimeStr}
                  placeholder="00:00"
                  placeholderTextColor="rgba(255,255,255,0.3)"
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <TouchableOpacity onPress={handleCaptureEnd} style={localStyles.captureBtn}>
                <MaterialIcons name="my-location" size={20} color="white" />
                <Text style={localStyles.captureText}>Capture</Text>
              </TouchableOpacity>
            </View>

            {/* Action Buttons */}
            <View style={localStyles.buttonRow}>
              <TouchableOpacity
                onPress={onClose}
                disabled={isSubmitting}
                style={[localStyles.cancelBtn, isSubmitting && { opacity: 0.5 }]}
              >
                <Text style={localStyles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleSubmit}
                disabled={isSubmitting}
                style={[localStyles.submitBtn, isSubmitting && { opacity: 0.7 }]}
              >
                {isSubmitting ? (
                  <ActivityIndicator color="black" />
                ) : (
                  <>
                    <MaterialIcons name="send" size={18} color="black" />
                    <Text style={localStyles.submitBtnText}>Submit</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      </View>
    </View>
  );
};

const localStyles = StyleSheet.create({
  centeredView: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 40,
  },
  modalContainer: {
    backgroundColor: 'rgba(20, 20, 20, 0.98)',
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 20,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    color: 'white',
    fontSize: 18,
    fontWeight: '700',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    gap: 20,
  },
  typeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  typeButtonActive: {
    backgroundColor: 'white',
    borderColor: 'white',
  },
  typeButtonText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 13,
    fontWeight: '600',
  },
  typeButtonTextActive: {
    color: 'black',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
  },
  label: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginBottom: 8,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: 'white',
    fontSize: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  captureBtn: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    height: 48,
    paddingHorizontal: 12,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  captureText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '600',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  cancelBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 16,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  submitBtn: {
    flex: 2,
    backgroundColor: 'white',
    borderRadius: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  submitBtnText: {
    color: 'black',
    fontSize: 16,
    fontWeight: '700',
  },
});

