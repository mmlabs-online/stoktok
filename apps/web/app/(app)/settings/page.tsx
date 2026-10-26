import { concentrationDefaultText, settingsToFormValues } from '@stoktok/core';
import { SettingsForm } from '../../../components/settings/settings-form';
import { getAppSettings, getDb } from '../../../server/db';
import { saveSettingsAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  const { saved } = await searchParams;
  const { settings, source } = await getAppSettings(getDb());
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Cài đặt</h1>
      <SettingsForm
        action={saveSettingsAction}
        initial={{ ok: false, fieldErrors: {}, values: settingsToFormValues(settings) }}
        feeConfigured={settings.feeRatePpm !== null}
        isDefault={source === 'default'}
        saved={saved === '1'}
        concentrationDefault={concentrationDefaultText()}
      />
    </div>
  );
}
