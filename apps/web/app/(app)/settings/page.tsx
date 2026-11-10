import { aiBudgetMeter, concentrationDefaultText, settingsToFormValues, userHolidayDates } from '@stoktok/core';
import { AiUsageCard } from '../../../components/settings/ai-usage-card';
import { SettingsForm } from '../../../components/settings/settings-form';
import { getAppSettings, getDb } from '../../../server/db';
import { readAiBudget } from '../../../server/ai-budget';
import { nowInstant, todayVn } from '../../../server/clock';
import { saveSettingsAction } from './actions';
import { requireUser } from '../../../server/auth/require-user';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<{ saved?: string }> }) {
  await requireUser();
  const { saved } = await searchParams;
  const { settings, source } = await getAppSettings(getDb());
  const ai = await readAiBudget();
  const meter = ai.ok ? aiBudgetMeter(ai.status, nowInstant()) : null;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Cài đặt</h1>
      <AiUsageCard read={ai} meter={meter} />
      <SettingsForm
        action={saveSettingsAction}
        initial={{ ok: false, fieldErrors: {}, values: settingsToFormValues(settings) }}
        feeConfigured={settings.feeRatePpm !== null}
        isDefault={source === 'default'}
        saved={saved === '1'}
        concentrationDefault={concentrationDefaultText()}
        savedHolidays={userHolidayDates(settings.holidays)}
        currentYear={Number(todayVn().slice(0, 4))}
      />
    </div>
  );
}
