<?php
/**
 * send.php — приём заявки и отправка на почту.
 * Лазерная Резка Металла
 *
 * Работает без внешних библиотек (mail() + multipart с вложениями).
 * Если рядом лежит папка vendor/ с PHPMailer и заполнен блок SMTP ниже,
 * письмо уходит через SMTP — это надёжнее доставляется на mail.ru.
 */

declare(strict_types=1);

// ===================== НАСТРОЙКИ =====================
const MAIL_TO        = 'laser454568@mail.ru';              // куда приходят заявки
const MAIL_FROM      = 'zayavka@lazermgn.ru';              // от кого (ящик на вашем домене!)
const MAIL_FROM_NAME = 'Сайт Лазерная Резка Металла';
const MAIL_SUBJECT   = 'Новая заявка с сайта';

// SMTP (по желанию, нужен PHPMailer: composer require phpmailer/phpmailer)
const USE_SMTP    = false;
const SMTP_HOST   = 'smtp.mail.ru';
const SMTP_PORT   = 465;
const SMTP_USER   = 'zayavka@lazermgn.ru';
const SMTP_PASS   = '';                                   // пароль ящика (только здесь, на сервере)

const MAX_FILES       = 5;
const MAX_FILE_BYTES  = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const RATE_LIMIT_SEC  = 30;                               // не чаще 1 заявки в 30 сек с одного IP
const TIMEZONE        = 'Asia/Yekaterinburg';

const ALLOWED_EXT = ['dxf','dwg','pdf','step','stp','iges','igs','cdr','ai','svg',
                     'jpg','jpeg','png','doc','docx','xls','xlsx','zip','rar'];
const ALLOWED_THICKNESS = ['0.5 мм','1 мм','1.5 мм','2 мм','3 мм','4 мм','5 мм','6 мм','8 мм','10 мм','12 мм','16 мм','20 мм'];
const ALLOWED_METAL     = ['Давальческий','ЛРМ'];
// =====================================================

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
date_default_timezone_set(TIMEZONE);

function respond(int $code, array $data): never {
    http_response_code($code);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(405, ['ok' => false, 'message' => 'Метод не поддерживается.']);
}

// Превышен post_max_size — PHP отбрасывает всё тело запроса
if (empty($_POST) && empty($_FILES) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    respond(413, ['ok' => false, 'message' => 'Файлы слишком большие для отправки.',
                  'errors' => ['files' => 'Общий размер файлов слишком большой']]);
}

// ---------- Honeypot: бот заполнил скрытое поле ----------
if (trim((string)($_POST['website'] ?? '')) !== '') {
    respond(200, ['ok' => true]);   // делаем вид, что всё хорошо
}

// ---------- Ограничение частоты (по IP, через временный файл) ----------
$ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
$rateFile = sys_get_temp_dir() . '/lrm_rate_' . md5($ip);
if (is_file($rateFile) && (time() - (int)@filemtime($rateFile)) < RATE_LIMIT_SEC) {
    respond(429, ['ok' => false, 'message' => 'Слишком частые отправки. Подождите немного и повторите.']);
}

// ---------- Чтение и очистка полей ----------
function clean(string $s, int $max): string {
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', '', $s) ?? '';
    $s = trim($s);
    return mb_substr($s, 0, $max);
}

$name      = clean((string)($_POST['name'] ?? ''), 120);
$thickness = clean((string)($_POST['thickness'] ?? ''), 20);
$metal     = clean((string)($_POST['metal'] ?? ''), 20);
$qty       = clean((string)($_POST['qty'] ?? ''), 10);
$bend      = ($_POST['bend']  ?? 'Нет') === 'Да' ? 'Да' : 'Нет';
$weld      = ($_POST['weld']  ?? 'Нет') === 'Да' ? 'Да' : 'Нет';
$paint     = ($_POST['paint'] ?? 'Нет') === 'Да' ? 'Да' : 'Нет';
$color     = $paint === 'Да' ? clean((string)($_POST['color'] ?? ''), 80) : '';
$phoneRaw  = clean((string)($_POST['phone'] ?? ''), 30);
$consent   = !empty($_POST['consent']);

// ---------- Серверная валидация ----------
$errors = [];
if (mb_strlen($name) < 2)                                $errors['name'] = 'Укажите имя или название организации';
if (!in_array($thickness, ALLOWED_THICKNESS, true))      $errors['thickness'] = 'Выберите толщину металла';
if (!in_array($metal, ALLOWED_METAL, true))              $errors['metal'] = 'Выберите, чей металл';
if (!ctype_digit($qty) || (int)$qty < 1 || (int)$qty > 100000) $errors['qty'] = 'Укажите количество — целое число от 1';
if ($paint === 'Да' && mb_strlen($color) < 2)            $errors['color'] = 'Укажите цвет покраски';

$digits = preg_replace('/\D/', '', $phoneRaw) ?? '';
if (strlen($digits) !== 11 || !in_array($digits[0], ['7', '8'], true)) {
    $errors['phone'] = 'Введите корректный телефон';
}
$phone = strlen($digits) === 11
    ? sprintf('+7 (%s) %s-%s-%s', substr($digits, 1, 3), substr($digits, 4, 3), substr($digits, 7, 2), substr($digits, 9, 2))
    : $phoneRaw;
if (!$consent) $errors['consent'] = 'Необходимо согласие на обработку данных';

// ---------- Файлы ----------
$attachments = [];   // [['path'=>..., 'name'=>..., 'size'=>..., 'mime'=>...]]
if (!empty($_FILES['files']) && is_array($_FILES['files']['name'])) {
    $f = $_FILES['files'];
    $count = count($f['name']);
    $total = 0;
    $fileErrs = [];
    $finfo = new finfo(FILEINFO_MIME_TYPE);

    for ($i = 0; $i < $count; $i++) {
        $err = $f['error'][$i];
        if ($err === UPLOAD_ERR_NO_FILE) continue;
        $orig = (string)$f['name'][$i];

        if (count($attachments) >= MAX_FILES) { $fileErrs[] = 'Не более ' . MAX_FILES . ' файлов'; break; }
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) { $fileErrs[] = "«{$orig}»: файл слишком большой"; continue; }
        if ($err !== UPLOAD_ERR_OK) { $fileErrs[] = "«{$orig}»: ошибка загрузки"; continue; }
        if (!is_uploaded_file($f['tmp_name'][$i])) continue;

        $size = (int)$f['size'][$i];
        if ($size > MAX_FILE_BYTES) { $fileErrs[] = "«{$orig}»: файл слишком большой (максимум 10 МБ)"; continue; }
        if ($size === 0)            { $fileErrs[] = "«{$orig}»: файл пустой"; continue; }

        // Расширение: берём только последнее и проверяем по белому списку.
        // Двойные расширения вида shell.php.dxf отсекаем отдельно.
        $ext = strtolower(pathinfo($orig, PATHINFO_EXTENSION));
        if (!in_array($ext, ALLOWED_EXT, true)) { $fileErrs[] = "«{$orig}»: формат не поддерживается"; continue; }
        if (preg_match('/\.(php\d?|phtml|phar|exe|js|bat|cmd|com|sh|vbs|msi|scr|jar|html?)\./i', $orig)) {
            $fileErrs[] = "«{$orig}»: формат не поддерживается"; continue;
        }

        // MIME-тип по содержимому: исполняемые и скриптовые типы не пропускаем
        $mime = (string)$finfo->file($f['tmp_name'][$i]);
        if (preg_match('~(x-httpd-php|x-php|x-dosexec|x-executable|x-msdownload|x-sh|x-shellscript|javascript|text/html)~i', $mime)) {
            $fileErrs[] = "«{$orig}»: формат не поддерживается"; continue;
        }

        $total += $size;
        if ($total > MAX_TOTAL_BYTES) { $fileErrs[] = 'Общий размер файлов больше 25 МБ'; break; }

        // Безопасное имя: только буквы, цифры, точка, дефис, подчёркивание
        $base = pathinfo($orig, PATHINFO_FILENAME);
        $base = preg_replace('/[^\p{L}\p{N}._ -]+/u', '_', $base) ?? 'file';
        $base = trim(mb_substr($base, 0, 80), " ._-") ?: 'file';

        $attachments[] = [
            'path' => $f['tmp_name'][$i],
            'name' => $base . '.' . $ext,
            'size' => $size,
            'mime' => $mime ?: 'application/octet-stream',
        ];
    }
    if ($fileErrs) $errors['files'] = implode('. ', array_unique($fileErrs));
}

if ($errors) {
    respond(422, ['ok' => false, 'message' => 'Проверьте заполнение формы.', 'errors' => $errors]);
}

// ---------- Текст письма ----------
function fmtSize(int $b): string {
    if ($b < 1024) return $b . ' Б';
    if ($b < 1048576) return round($b / 1024) . ' КБ';
    return number_format($b / 1048576, 1, ',', '') . ' МБ';
}

$lines = [
    'Имя / организация: ' . $name,
    'Толщина металла: '   . $thickness,
    'Металл: '            . $metal,
    'Количество: '        . $qty . ' шт.',
    'Гибка: '             . $bend,
    'Сварка: '            . $weld,
    'Покраска: '          . $paint . ($paint === 'Да' ? ' (цвет: ' . $color . ')' : ''),
    'Контактный телефон: ' . $phone,
    '',
];
if ($attachments) {
    $lines[] = 'Приложенные файлы (' . count($attachments) . '):';
    foreach ($attachments as $a) $lines[] = ' — ' . $a['name'] . ' (' . fmtSize($a['size']) . ')';
} else {
    $lines[] = 'Файлы не приложены.';
}
$lines[] = '';
$lines[] = 'Отправлено: ' . date('d.m.Y H:i:s') . ' (' . TIMEZONE . ')';
$lines[] = 'IP: ' . $ip;
$body = implode("\r\n", $lines);

// ---------- Отправка ----------
function encHeader(string $s): string {
    return '=?UTF-8?B?' . base64_encode($s) . '?=';
}

$sent = false;

// Вариант 1: PHPMailer + SMTP (если включён и установлен)
if (USE_SMTP && is_file(__DIR__ . '/vendor/autoload.php')) {
    require __DIR__ . '/vendor/autoload.php';
    try {
        $m = new PHPMailer\PHPMailer\PHPMailer(true);
        $m->isSMTP();
        $m->Host       = SMTP_HOST;
        $m->Port       = SMTP_PORT;
        $m->SMTPAuth   = true;
        $m->Username   = SMTP_USER;
        $m->Password   = SMTP_PASS;
        $m->SMTPSecure = PHPMailer\PHPMailer\PHPMailer::ENCRYPTION_SMTPS;
        $m->CharSet    = 'UTF-8';
        $m->setFrom(MAIL_FROM, MAIL_FROM_NAME);
        $m->addAddress(MAIL_TO);
        $m->Subject = MAIL_SUBJECT;
        $m->Body    = $body;
        $m->isHTML(false);
        foreach ($attachments as $a) $m->addAttachment($a['path'], $a['name'], 'base64', $a['mime']);
        $m->send();
        $sent = true;
    } catch (Throwable $e) {
        error_log('[send.php] SMTP error: ' . $e->getMessage());
    }
}

// Вариант 2: встроенный mail() с multipart/mixed
if (!$sent) {
    $boundary = 'lrm_' . bin2hex(random_bytes(12));
    $headers  = [
        'From: ' . encHeader(MAIL_FROM_NAME) . ' <' . MAIL_FROM . '>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="' . $boundary . '"',
        'X-Mailer: LRM-form',
    ];

    $msg  = "--{$boundary}\r\n";
    $msg .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $msg .= "Content-Transfer-Encoding: base64\r\n\r\n";
    $msg .= chunk_split(base64_encode($body)) . "\r\n";

    foreach ($attachments as $a) {
        $data = file_get_contents($a['path']);
        if ($data === false) continue;
        $fn = encHeader($a['name']);
        $msg .= "--{$boundary}\r\n";
        $msg .= "Content-Type: {$a['mime']}; name=\"{$fn}\"\r\n";
        $msg .= "Content-Transfer-Encoding: base64\r\n";
        $msg .= "Content-Disposition: attachment; filename=\"{$fn}\"\r\n\r\n";
        $msg .= chunk_split(base64_encode($data)) . "\r\n";
    }
    $msg .= "--{$boundary}--";

    // -f задаёт Return-Path, помогает проходить спам-фильтры
    $sent = @mail(MAIL_TO, encHeader(MAIL_SUBJECT), $msg, implode("\r\n", $headers), '-f' . MAIL_FROM);
}

// PHP сам удаляет временные файлы по окончании скрипта, но на всякий случай:
foreach ($attachments as $a) { if (is_file($a['path'])) @unlink($a['path']); }

if (!$sent) {
    error_log('[send.php] Не удалось отправить письмо');
    respond(500, ['ok' => false, 'message' => 'Не удалось отправить заявку.']);
}

@touch($rateFile);
respond(200, ['ok' => true]);
