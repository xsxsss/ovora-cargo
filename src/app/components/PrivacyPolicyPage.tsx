import { ArrowLeft, Shield, Lock, Eye, UserCheck, FileText, Database, Globe } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useTheme } from '../context/ThemeContext';

export function PrivacyPolicyPage() {
  const navigate = useNavigate();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const bg      = 'bg-[#060e1a]';
  const txt     = isDark ? 'text-white' : 'text-[#0f172a]';
  const sub     = isDark ? 'text-[#64748b]' : 'text-slate-500';
  const divider = isDark ? 'border-white/[0.06]' : 'border-black/[0.06]';

  const sections = [
    {
      icon: Database,
      title: '1. Какие данные мы собираем',
      items: [
        'Персональные данные: имя, фамилия, дата рождения',
        'Контактная информация: email, номер телефона',
        'Данные об автомобиле (для водителей): марка, модель, номер',
        'Документы: водительское удостоверение, техпаспорт',
        'Геолокация: данные GPS для отслеживания поездок',
        'История поездок: маршруты, даты, стоимость',
        'Платежная информация: история транзакций',
        'Отзывы и рейтинги',
      ],
    },
    {
      icon: Eye,
      title: '2. Как мы используем ваши данные',
      items: [
        'Предоставление услуг платформы Ovora Cargo',
        'Связь между водителями и отправителями',
        'Обработка платежей и финансовых операций',
        'Улучшение качества сервиса',
        'Обеспечение безопасности пользователей',
        'Отправка уведомлений о поездках',
        'Соблюдение законодательства Таджикистана',
        'Предотвращение мошенничества',
      ],
    },
    {
      icon: Lock,
      title: '3. Защита ваших данных',
      items: [
        'Шифрование данных при передаче (SSL/TLS)',
        'Безопасное хранение в базе данных Supabase',
        'Ограниченный доступ к данным только авторизованным сотрудникам',
        'Регулярные проверки безопасности',
        'Двухфакторная аутентификация',
        'Мониторинг подозрительной активности',
      ],
    },
    {
      icon: UserCheck,
      title: '4. Ваши права',
      items: [
        'Право на доступ к своим данным',
        'Право на исправление неточных данных',
        'Право на удаление данных («право на забвение»)',
        'Право на ограничение обработки',
        'Право на перенос данных',
        'Право на отзыв согласия в любое время',
        'Право на подачу жалобы в надзорный орган',
      ],
    },
    {
      icon: FileText,
      title: '5. Передача данных третьим лицам',
      items: [
        'Картографические сервисы: Yandex Maps для навигации',
        'Аналитика посещений: Яндекс.Метрика — обезличенно; телефоны и номера в адресах страниц скрываются, переписка, документы и платежи в записи сессий не попадают',
        'Правоохранительные органы: при законных основаниях',
        'МЫ НЕ ПРОДАЕМ ваши данные третьим лицам',
        'МЫ НЕ ОБРАБАТЫВАЕМ ПЛАТЕЖИ — все расчёты напрямую',
      ],
    },
    {
      icon: Globe,
      title: '6. Файлы cookie',
      items: [
        'Мы используем cookie для улучшения работы сайта',
        'Обязательные cookie: для авторизации и безопасности',
        'Аналитические cookie Яндекс.Метрики: для статистики посещений',
        'Вы можете отключить cookie в настройках браузера',
      ],
    },
  ];

  return (
    <div className={`min-h-screen flex flex-col font-['Sora'] ${bg} ${txt} md:max-w-3xl md:mx-auto`}>

      {/* Header */}
      <header className={`sticky top-0 z-20 flex items-center gap-3 px-4 py-3 border-b backdrop-blur-xl ${
        isDark ? 'bg-[#060e1a]/95 border-white/[0.06]' : 'bg-[#060e1a]/95 border-white/[0.06]'
      }`}>
        <button onClick={() => navigate(-1)} className={`w-9 h-9 flex items-center justify-center active:scale-90 ${isDark ? 'text-white' : 'text-[#0f172a]'}`}>
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className={`text-[18px] font-bold ${txt}`}>Конфиденциальность</h1>
      </header>

      <div className="flex-1 pb-28">

        {/* Hero */}
        <div className={`px-4 py-8 text-center border-b ${divider}`}>
          <Shield className="w-12 h-12 text-[#1978e5] mx-auto mb-3" strokeWidth={1.5} />
          <h2 className={`text-[20px] font-bold mb-1 ${txt}`}>Ваша конфиденциальность — наш приоритет</h2>
          <p className={`text-[13px] ${sub}`}>Мы серьёзно относимся к защите ваших персональных данных</p>
          <p className={`text-[11px] mt-2 ${sub}`}>Последнее обновление: 6 марта 2026 г.</p>
        </div>

        {/* Intro */}
        <div className={`px-4 py-4 border-b ${divider}`}>
          <p className={`text-[14px] leading-relaxed ${sub}`}>
            Настоящая Политика конфиденциальности описывает, как <span className={`font-bold ${txt}`}>Ovora Cargo</span> собирает,
            использует, хранит и защищает вашу персональную информацию при использовании нашей платформы.
          </p>
        </div>

        {/* Sections */}
        {sections.map((section, idx) => {
          const Icon = section.icon;
          return (
            <div key={idx} className={`border-b ${divider}`}>
              <div className={`flex items-center gap-3 px-4 py-3.5`}>
                <Icon className="w-4 h-4 text-[#1978e5] shrink-0" />
                <p className={`text-[14px] font-bold ${txt}`}>{section.title}</p>
              </div>
              {section.items.map((item, i) => (
                <div key={i} className={`flex items-start gap-3 px-4 py-2.5 border-t ${divider} ${isDark ? 'bg-white/[0.01]' : 'bg-black/[0.01]'}`}>
                  <span className="text-[#1978e5] mt-0.5 shrink-0">·</span>
                  <span className={`text-[13px] leading-relaxed ${sub}`}>{item}</span>
                </div>
              ))}
            </div>
          );
        })}

        {/* Contact */}
        <div className={`px-4 py-4 border-b ${divider}`}>
          <p className={`text-[14px] font-bold mb-3 ${txt}`}>Вопросы о конфиденциальности</p>
          <div className={`space-y-2 text-[13px] ${sub}`}>
            <div>📧 privacy@ovoracargo.tj</div>
            <div>📞 +992 (92) 777-00-00</div>
            <div>📍 г. Душанбе, ул. Рудаки, 95</div>
          </div>
        </div>

        <div className={`px-4 py-4`}>
          <p className={`text-[12px] leading-relaxed ${sub}`}>
            Мы оставляем за собой право вносить изменения в настоящую Политику конфиденциальности.
            Все изменения будут опубликованы на этой странице с обновленной датой.
          </p>
        </div>
      </div>
    </div>
  );
}