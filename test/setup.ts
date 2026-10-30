import { pinWording } from '@/lib/messages';

// Every message says its first wording, so tests can check what it says.
pinWording();

// Tests never talk to Claude; those that need the assistant pass a stand-in.
delete process.env.ANTHROPIC_API_KEY;
