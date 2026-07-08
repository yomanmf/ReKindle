export async function onRequest(context) {
    const { request } = context;
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = new Headers();
    corsHeaders.set('Access-Control-Allow-Origin', '*');
    corsHeaders.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    corsHeaders.set('Access-Control-Allow-Headers', '*');
    corsHeaders.set('Content-Type', 'application/json');

    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
    }

    function errorResponse(message, status) {
        return new Response(JSON.stringify({ error: message }), {
            status: status,
            headers: corsHeaders
        });
    }

    let body = {};
    if (request.method === 'POST') {
        try {
            body = await request.json();
        } catch (e) {
            return errorResponse('Invalid JSON body', 400);
        }
    }

    const region = body.region || 'en';
    const childMode = body.childMode === true;

    const lang = region.split('_')[0];
    const theme = region.split('_')[1];
    const baseUrl = 'https://' + lang + '.akinator.com';

    let sid = 1;
    if (theme === 'objects') sid = 2;
    else if (theme === 'animals') sid = 14;

    const akiHeaders = new Headers();
    akiHeaders.set('Content-Type', 'application/x-www-form-urlencoded');
    akiHeaders.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    akiHeaders.set('X-Requested-With', 'XMLHttpRequest');
    akiHeaders.set('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');

    try {
        if (path === '/api/akinator' || path === '/api/akinator/') {
            return new Response(JSON.stringify({
                ok: true,
                version: '1.0.0',
                deployed: true,
                path: path,
                time: new Date().toISOString()
            }), { headers: corsHeaders });
        }

        if (path.endsWith('/start')) {
            const startBody = 'cm=' + (childMode ? 'true' : 'false') + '&sid=' + sid;
            const res = await fetch(baseUrl + '/game', {
                method: 'POST',
                headers: akiHeaders,
                body: startBody
            });

            if (!res.ok) {
                return errorResponse('Akinator returned ' + res.status + ' while starting game', 502);
            }

            const html = await res.text();
            const session = extractFirst(html, [
                /session:\s*'([^']+)'/,
                /id=["']session["'][^>]*value=["']([^"']+)["']/i,
                /value=["']([^"']+)["'][^>]*id=["']session["']/i
            ]);
            const signature = extractFirst(html, [
                /signature:\s*'([^']+)'/,
                /id=["']signature["'][^>]*value=["']([^"']+)["']/i,
                /value=["']([^"']+)["'][^>]*id=["']signature["']/i
            ]);
            const question = extractFirst(html, [
                /<p[^>]*class=["'][^"']*question-text[^"']*["'][^>]*id=["']question-label["'][^>]*>([\s\S]*?)<\/p>/i,
                /<[^>]*id=["']question-label["'][^>]*>([\s\S]*?)<\//i
            ]);

            if (!session || !signature || !question) {
                return errorResponse('Could not parse Akinator session. The site may be using bot protection.', 502);
            }

            const answers = parseAnswerLabels(html);

            return new Response(JSON.stringify({
                session: session,
                signature: signature,
                question: question.trim(),
                baseUrl: baseUrl,
                sid: sid,
                region: region,
                answers: answers
            }), { headers: corsHeaders });
        }

        if (path.endsWith('/answer')) {
            const step = body.step;
            const progression = body.progression;
            const answer = body.answer;
            const session = body.session;
            const signature = body.signature;
            const stepLast = body.stepLast || '';

            if (typeof step === 'undefined' || typeof progression === 'undefined' || typeof answer === 'undefined' || !session || !signature) {
                return errorResponse('Missing required answer parameters', 400);
            }

            const answerBody = buildForm({
                step: step,
                progression: progression,
                sid: sid,
                cm: childMode ? 'true' : 'false',
                answer: answer,
                step_last_proposition: stepLast,
                session: session,
                signature: signature
            });

            const res = await fetch(baseUrl + '/answer', {
                method: 'POST',
                headers: akiHeaders,
                body: answerBody
            });

            if (!res.ok) {
                return errorResponse('Akinator returned ' + res.status + ' while answering', 502);
            }

            const text = await res.text();
            const data = parseJsonOrText(text);
            return new Response(JSON.stringify(data), { headers: corsHeaders });
        }

        if (path.endsWith('/back')) {
            const step = body.step;
            const progression = body.progression;
            const session = body.session;
            const signature = body.signature;

            if (typeof step === 'undefined' || typeof progression === 'undefined' || !session || !signature) {
                return errorResponse('Missing required back parameters', 400);
            }

            const backBody = buildForm({
                step: step,
                progression: progression,
                sid: sid,
                cm: childMode ? 'true' : 'false',
                session: session,
                signature: signature
            });

            const res = await fetch(baseUrl + '/cancel_answer', {
                method: 'POST',
                headers: akiHeaders,
                body: backBody
            });

            if (!res.ok) {
                return errorResponse('Akinator returned ' + res.status + ' while going back', 502);
            }

            const text = await res.text();
            const data = parseJsonOrText(text);
            return new Response(JSON.stringify(data), { headers: corsHeaders });
        }

        return errorResponse('Unknown action. Use /start, /answer, or /back.', 404);
    } catch (e) {
        console.error('Akinator proxy error:', e);
        return errorResponse(e.message || 'Internal proxy error', 500);
    }
}

function extractFirst(text, patterns) {
    for (let i = 0; i < patterns.length; i++) {
        const match = text.match(patterns[i]);
        if (match && match[1]) {
            return match[1];
        }
    }
    return null;
}

function parseAnswerLabels(html) {
    const ids = ['a_yes', 'a_no', 'a_dont_know', 'a_probably', 'a_probaly_not'];
    const answers = [];
    for (let i = 0; i < ids.length; i++) {
        const regex = new RegExp("<a[^>]*id=[\"']" + ids[i] + "[\"'][^>]*onclick=[\"']chooseAnswer\\(" + i + "\\)[\"'][^>]*>([\\s\\S]*?)<\\/a>", 'i');
        const match = html.match(regex);
        answers.push(match && match[1] ? match[1].trim() : null);
    }
    return answers;
}

function buildForm(params) {
    const parts = [];
    const keys = Object.keys(params);
    for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
    }
    return parts.join('&');
}

function parseJsonOrText(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return { raw: text };
    }
}
