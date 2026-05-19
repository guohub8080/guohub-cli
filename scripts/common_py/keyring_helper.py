import keyring

from scripts.common_py.GUOHUB_CLI_CONFIG import NAME_SPACE


def guohub_get_credential(name):
    return keyring.get_password(NAME_SPACE, name)


def guohub_set_credential(name, value):
    keyring.set_password(NAME_SPACE, name, value)


def guohub_delete_credential(name):
    keyring.delete_password(NAME_SPACE, name)
