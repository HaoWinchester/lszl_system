import json
import pytest

def test_model_output_accepts_fenced_json_but_rejects_wrong_contract():
    from app.services.teacher_assistant_model import decode_reply, ModelError
    assert decode_reply('```json\n{"reply":"请确认","settings":{}}\n```')['reply']=='请确认'
    with pytest.raises(ModelError): decode_reply('{"reply":123}')
    with pytest.raises(ModelError): decode_reply('无法处理')

def test_cli_is_explicit_package_model_and_has_no_host_tools():
    from app.services.teacher_assistant_model import command
    args=command()
    assert args[args.index('--model')+1]=='glm-5.3-flash[1m]'
    assert args[args.index('--tools')+1]==''
    assert '--bare' in args and '--no-session-persistence' in args
    assert '--dangerously-skip-permissions' not in args
