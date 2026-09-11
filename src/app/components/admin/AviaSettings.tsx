import { useState, useEffect } from 'react';
import { Bell, DollarSign, Globe, Shield, Smartphone, Save, AlertCircle, Loader2, CheckCircle, SlidersHorizontal } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';
import { toast } from 'sonner';
import { getAviaAdminSettings, updateAviaAdminSettings } from '../../api/aviaAdminApi';
import { AdminPageHeader, HeaderBtn } from './AdminPageHeader';

const DEFAULTS = {
  platformName: 'Ovora AVIA',
  supportEmail: 'support@ovora.tj',
  supportPhone: '+992 92 000 0000',
  // Каналы, которые видит пользователь при замене паспорта.
  // Telegram — логин без «@». WhatsApp — только цифры с кодом страны.
  // Пустое значение = канал не показывается.
  supportTelegram: 'OvoraHelp',
  supportWhatsapp: '',
  currency: 'TJS',
  language: 'ru',
  emailNotifications: true,
  pushNotifications: true,
  newDealNotification: true,
  dealAcceptedNotification: true,
  flightStatusNotification: true,
  platformCommission: 10,
  requirePassportVerification: true,
  requirePhoneVerification: true,
  autoBlacklistCheck: true,
  ratingSystem: true,
  inAppChat: true,
  podRequired: true,
};

type SettingsType = typeof DEFAULTS;

export function AviaSettings() {
  const [settings, setSettings] = useState<SettingsType>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await getAviaAdminSettings();
        if (data && Object.keys(data).length > 0) {
          setSettings({ ...DEFAULTS, ...data });
          if (data.updatedAt) setSavedAt(data.updatedAt);
        }
      } catch {
        // Используем значения по умолчанию
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateAviaAdminSettings(settings);
      setSavedAt(new Date().toISOString());
      toast.success('✅ Настройки AVIA сохранены');
    } catch {
      toast.error('Ошибка сохранения настроек');
    } finally {
      setSaving(false);
    }
  };

  const set = (key: keyof SettingsType, val: any) =>
    setSettings(prev => ({ ...prev, [key]: val }));

  const toggle = (key: keyof SettingsType) =>
    setSettings(prev => ({ ...prev, [key]: !prev[key] }));

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-8 h-8 animate-spin text-sky-600" />
      <span className="ml-3 text-gray-600">Загрузка настроек...</span>
    </div>
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Настройки AVIA"
        subtitle={savedAt
          ? `Последнее сохранение: ${new Date(savedAt).toLocaleString('ru-RU')}`
          : 'Настройки хранятся в Supabase KV Store'}
        icon={SlidersHorizontal}
        gradient="linear-gradient(135deg,#0ea5e9,#38bdf8)"
        accent="#0ea5e9"
        actions={<HeaderBtn onClick={handleSave} icon={saving ? Loader2 : Save}>{saving ? 'Сохранение...' : 'Сохранить'}</HeaderBtn>}
      />

      {/* General */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Globe className="w-5 h-5 text-sky-600" />
            Общие настройки
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { id: 'platformName', label: 'Название платформы', type: 'text' },
              { id: 'supportEmail', label: 'Email поддержки', type: 'email' },
              { id: 'supportPhone', label: 'Телефон поддержки', type: 'tel' },
              { id: 'supportTelegram', label: 'Telegram поддержки (логин без @)', type: 'text' },
              { id: 'supportWhatsapp', label: 'WhatsApp поддержки (только цифры, напр. 992900112233)', type: 'tel' },
            ].map(f => (
              <div key={f.id}>
                <Label htmlFor={f.id} className="text-sm">{f.label}</Label>
                <input id={f.id} type={f.type}
                  value={(settings as any)[f.id]}
                  onChange={e => set(f.id as any, e.target.value)}
                  className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm"
                />
              </div>
            ))}
            <div>
              <Label htmlFor="currency" className="text-sm">Валюта</Label>
              <select id="currency" value={settings.currency}
                onChange={e => set('currency', e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm">
                <option value="TJS">Сомони (ТЖС)</option>
                <option value="USD">Доллар США ($)</option>
                <option value="RUB">Рубль (₽)</option>
                <option value="EUR">Евро (€)</option>
              </select>
            </div>
            <div>
              <Label htmlFor="language" className="text-sm">Язык системы</Label>
              <select id="language" value={settings.language}
                onChange={e => set('language', e.target.value)}
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm">
                <option value="ru">Русский</option>
                <option value="tg">Таджикский</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Commission */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            Комиссия платформы
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <Label htmlFor="platformCommission" className="text-sm">Комиссия платформы (%)</Label>
              <input id="platformCommission" type="number" step="1"
                value={settings.platformCommission}
                onChange={e => set('platformCommission', Number(e.target.value))}
                className="w-full mt-1 px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 text-sm"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bell className="w-5 h-5 text-purple-600" />
            Уведомления
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {[
              { id: 'emailNotifications', label: 'Email уведомления', desc: 'Отправка уведомлений по email' },
              { id: 'pushNotifications', label: 'Push уведомления', desc: 'Push-уведомления в приложение' },
              { id: 'newDealNotification', label: 'Новая сделка', desc: 'Уведомлять курьера о новых заявках на рейс' },
              { id: 'dealAcceptedNotification', label: 'Сделка принята', desc: 'Уведомление отправителю при подтверждении сделки' },
              { id: 'flightStatusNotification', label: 'Изменение статуса рейса', desc: 'Уведомлять об изменении статуса рейса' },
            ].map((item, i, arr) => (
              <div key={item.id} className={`flex items-center justify-between gap-3 py-3 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{item.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                </div>
                <Switch id={item.id} checked={(settings as any)[item.id]} onCheckedChange={() => toggle(item.id as any)} className="flex-shrink-0" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Safety */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="w-5 h-5 text-red-600" />
            Безопасность
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {[
              { id: 'requirePassportVerification', label: 'Обязательная верификация паспорта', desc: 'Курьеры должны загрузить паспорт перед началом работы' },
              { id: 'requirePhoneVerification', label: 'Верификация телефона', desc: 'Требовать подтверждение номера телефона через OTP' },
              { id: 'autoBlacklistCheck', label: 'Автопроверка чёрного списка', desc: 'Блокировать регистрацию/сделки с номерами из чёрного списка' },
            ].map((item, i, arr) => (
              <div key={item.id} className={`flex items-center justify-between gap-3 py-3 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{item.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                </div>
                <Switch id={item.id} checked={(settings as any)[item.id]} onCheckedChange={() => toggle(item.id as any)} className="flex-shrink-0" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Features */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Smartphone className="w-5 h-5 text-sky-600" />
            Функции платформы
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-0">
            {[
              { id: 'ratingSystem', label: 'Система рейтингов', desc: 'Оценки и отзывы после завершения сделки' },
              { id: 'inAppChat', label: 'Встроенный чат', desc: 'Общение курьера и отправителя в приложении' },
              { id: 'podRequired', label: 'Подтверждение доставки (POD)', desc: 'Требовать фото-подтверждение при завершении сделки' },
            ].map((item, i, arr) => (
              <div key={item.id} className={`flex items-center justify-between gap-3 py-3 ${i < arr.length - 1 ? 'border-b border-gray-100' : ''}`}>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{item.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{item.desc}</p>
                </div>
                <Switch id={item.id} checked={(settings as any)[item.id]} onCheckedChange={() => toggle(item.id as any)} className="flex-shrink-0" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Save button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {savedAt && (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle className="w-4 h-4" />
              Сохранено {new Date(savedAt).toLocaleTimeString('ru-RU')}
            </div>
          )}
        </div>
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-6 py-3 bg-sky-600 text-white rounded-xl hover:bg-sky-700 transition-colors font-medium disabled:opacity-60">
          {saving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
          {saving ? 'Сохранение...' : 'Сохранить настройки'}
        </button>
      </div>

      <Card className="bg-sky-50 border-sky-200">
        <CardContent className="p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-sky-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-sky-900">Хранение в базе данных</p>
            <p className="text-sm text-sky-700 mt-0.5">
              Все настройки сохраняются в Supabase KV Store (ключ <code className="font-mono text-xs bg-sky-100 px-1 py-0.5 rounded">ovora:avia-admin:settings</code>) отдельно от настроек CARGO.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
