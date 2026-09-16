import {
  getCapabilitiesAsync, requestPermissionsAsync, sendAsync, getResultsAsync, acknowledgeAsync,
} from '../../modules/nature-sms';
import type { SmsDevice } from './sms-device-types';

export type { SmsCapabilities, SmsNativeResult, SmsSendInput } from './sms-device-types';

export const smsDevice: SmsDevice = {
  getCapabilities: getCapabilitiesAsync,
  requestPermissions: requestPermissionsAsync,
  send: sendAsync,
  getResults: getResultsAsync,
  acknowledge: acknowledgeAsync,
};
export const getCapabilities = smsDevice.getCapabilities;
export const requestPermissions = smsDevice.requestPermissions;
