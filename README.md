# Retronex Bot

Türk Habbo Retro topluluğu için Discord botu (discord.js v14, Node 22.13+, SQLite).

## Özellikler

| Alan | Komutlar |
|---|---|
| **Seviye sistemi** | `/seviye`, `/siralama`, `/seviye-ayar rol-ekle\|rol-sil\|roller\|durum\|xp-ver\|sifirla` — mesaj başına XP (60 sn bekleme), seviye atlama duyurusu, seviye rolleri (en yüksek ulaşılan rol tutulur) |
| **Moderasyon** | `/ban` `/unban` `/at` `/sustur` `/susturma-kaldir` `/uyar` `/uyarilar` `/uyari-sil` `/cezalar` `/temizle` `/kilitle` `/kilit-ac` `/yavasmod` — rol hiyerarşisi kontrolü, numaralı ceza kaydı, mod-log, cezalıya DM, eşik aşılınca otomatik susturma (`/ayar ceza-esigi`) |
| **Rapor** | `/rapor kullanici sebep [kanit]` ve mesaja sağ tık → *Uygulamalar → Mesajı Raporla*. Rapor kanalına butonlu (İşlem yapıldı / Geçersiz) düşer, sonuç raporlayana DM'lenir |
| **İtiraz** | `/itiraz ceza-no` → form → itiraz kanalına düşer. Yetkili **Kabul** ederse ceza otomatik geri alınır (unban / susturma kaldırma / uyarı geçersiz), sonuç DM'lenir. Banlı kullanıcılar için bota DM'den de çalışır |
| **Otomatik moderasyon** | `/otomod kur` Discord'un **yerleşik AutoMod** kurallarını oluşturur (küfür/hakaret/cinsel içerik preset'i, spam, toplu etiket + 5 dk timeout, davet linki). `/otomod kelime-ekle\|kelime-sil\|kelime-liste` özel yasaklı kelimeler, `/otomod durum` kuralları + sunucu doğrulama seviyesini gösterir. AutoMod'un engellediği her mesaj otomatik uyarı olarak kaydedilir ve eşik sistemine işler |
| **Destek biletleri** | Bot açılışta `TICKET_PANEL_CHANNEL_ID` kanalına embed + kategori menüsü gönderir (varsa günceller). Seçime göre `TICKET_CATEGORY_ID` kategorisinde özel kanal açılır (kullanıcı + `/ayar yetkili-rol` rolü görür); kullanıcı başına tek açık bilet, 🔒 butonla kapanır |
| **Özel ses kanalı** | Hub kanalına (ID `config.js` / `.env`: `VOICE_HUB_CHANNEL_ID`) girene `[💎] kullaniciadi` adlı özel oda açılır, boşalınca silinir, sahip çıkarsa sahiplik otomatik devredilir. `/ses panel` buton paneli; `/ses kilitle\|ac\|gizle\|goster\|isim\|limit\|izin\|yasakla\|at\|devret\|devral\|bilgi\|sil` |

## Kurulum

1. [Developer Portal](https://discord.com/developers/applications) → yeni uygulama → **Bot**:
   - **Server Members Intent**'i aç (Message Content gerekmez).
2. Botu davet et: `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot%20applications.commands&permissions=1099645185046`  
   (Yönetici vermek yerine şu yetkiler yeterli: Sunucuyu Yönet [AutoMod için], Rolleri Yönet, Kanalları Yönet, Üyeleri At/Yasakla/Zaman Aşımı, Mesajları Yönet, Üyeleri Taşı, Kanalları Gör, Mesaj/Embed Gönder, Ses'e Bağlan.)
3. Botun rolünü, yöneteceği rollerin (seviye rolleri, üyeler) **üstüne** taşı.
4. ```bash
   cp .env.example .env   # token ve CLIENT_ID'yi doldur
   npm install
   npm run deploy         # slash komutlarını yükler
   npm start
   ```
5. Sunucuda ilk ayarlar:
   ```
   /ayar mod-log #mod-log
   /ayar rapor-kanali #raporlar
   /ayar itiraz-kanali #itirazlar
   /ayar yetkili-rol @Moderatör     (opsiyonel; AutoMod muafiyeti ve etiketleme)
   /otomod kur
   /ses panel                       (ses yönetim butonları)
   /seviye-ayar rol-ekle seviye:5 rol:@Aktif
   ```

## Web paneli (metin düzenleme)

Botun gönderdiği **tüm metinler** (yanıtlar, embed başlık/alan/alt yazıları, buton ve menü etiketleri, DM'ler, log mesajları, modal pencereler, bilet paneli, renkler — ~290 adet) web panelinden düzenlenir. Değişiklik anında geçerli olur, yeniden başlatma gerekmez.

```env
PANEL_PASSWORD=en-az-10-karakterli-guclu-sifre   # tanımlı değilse panel kapalı kalır
PANEL_PORT=3000                                  # varsayılan 3000
PANEL_HOST=127.0.0.1                             # varsayılan sadece yerel; dışarı açmak için 0.0.0.0
```

- Açılış: `http://127.0.0.1:3000`. Sunucuda çalışıyorsa SSH tüneli (`ssh -L 3000:127.0.0.1:3000 sunucu`) ya da HTTPS veren bir ters vekil (nginx/Caddy) arkasında kullan; bu durumda `PANEL_COOKIE_SECURE=true` (ve vekil IP'si için `PANEL_TRUST_PROXY=true`) ekle. Şifreyi düz HTTP üzerinden internete açma.
- `{kullanici}`, `{case}` gibi **değişkenler** her metnin altında listelenir (tıklayınca eklenir); listede olmayan değişken kaydedilmez. Discord karakter sınırları (başlık 256, açıklama 2000, buton 80…) denetlenir. Altta Discord benzeri **önizleme** görünür.
- **Sıfırla** düğmesi metni varsayılana döndürür. Varsayılanlar `src/catalog.js` içindedir; yeni bir metin eklemek için oraya satır ekleyip kodda `t('anahtar')` kullan (`npm run check` eksik/kullanılmayan anahtarları yakalar).
- Bilet paneli metinleri (başlık, açıklama, menü, kategori adları, renk) kaydedilince Discord'daki mesaj **otomatik güncellenir**; elle için "🎫 Bilet panelini güncelle".
- Panelden değişmeyenler: slash komut adları/açıklamaları (Discord'a `npm run deploy` ile yüklenir), AutoMod kural adları, sunucu denetim kaydı (audit log) sebepleri. Seviye/ceza eşikleri gibi sayısal ayarlar `/ayar` ile yapılır.

## Notlar

- `GUILD_ID` doluysa komutlar anında o sunucuya yüklenir (geliştirme için); boşsa global yüklenir ve `/itiraz` bot DM'inde de çalışır.
- Veri `data/retronex.db` (SQLite) dosyasındadır; yedeklemek için bu dosyayı kopyala.
- Discord'un AutoMod preset'leri dil kapsamı sınırlıdır; Türkçe küfürler için `/otomod kelime-ekle` ile kendi listeni ekle (`*kelime*` jokeri destekler).
- Kontrol: `npm run check` (token gerektirmez).
