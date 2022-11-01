import sha256 from 'js-sha256';
import BN from 'bn.js';

import { Enum, Assignable } from './utils/enums';
import { serialize, deserialize } from 'borsh';
import { KeyType, PublicKey } from './utils/key_pair';
import { Signer } from './signer';
import { KeyPair } from './utils/key_pair';

export class FunctionCallPermission extends Assignable {
    allowance?: BN;
    receiverId: string;
    methodNames: string[];
}

export class FullAccessPermission extends Assignable {}

export class AccessKeyPermission extends Enum {
    functionCall: FunctionCallPermission;
    fullAccess: FullAccessPermission;
}

export class AccessKey extends Assignable {
    nonce: number;
    permission: AccessKeyPermission;
}

export function fullAccessKey(): AccessKey {
    return new AccessKey({ nonce: 0, permission: new AccessKeyPermission({fullAccess: new FullAccessPermission({})}) });
}

export function functionCallAccessKey(receiverId: string, methodNames: string[], allowance?: BN): AccessKey {
    return new AccessKey({ nonce: 0, permission: new AccessKeyPermission({functionCall: new FunctionCallPermission({receiverId, allowance, methodNames})})});
}

export class IAction extends Assignable {}

class CreateAccount extends IAction {}
class DeployContract extends IAction { code: Uint8Array; }
class FunctionCall extends IAction { methodName: string; args: Uint8Array; gas: BN; deposit: BN; }
class Transfer extends IAction { deposit: BN; }
class Stake extends IAction { stake: BN; publicKey: PublicKey; }
class AddKey extends IAction { publicKey: PublicKey; accessKey: AccessKey; }
class DeleteKey extends IAction { publicKey: PublicKey; }
class DeleteAccount extends IAction { beneficiaryId: string; }
class NonDelegateAction extends Assignable {
    action: Action;
}
class DelegateAction extends Assignable {
    senderId: string;
    receiverId: string;
    actions: NonDelegateAction[];
    nonce: number;
    blockHash: Uint8Array;
    publicKey: PublicKey;
}
class SignedDelegateAction extends IAction {
    delegateAction: DelegateAction;
    signature: Signature;
}

export function createAccount(): Action {
    return new Action({createAccount: new CreateAccount({}) });
}

export function deployContract(code: Uint8Array): Action {
    return new Action({ deployContract: new DeployContract({code}) });
}

export function stringifyJsonOrBytes(args: any): Buffer {
    const isUint8Array = args.byteLength !== undefined && args.byteLength === args.length;
    const serializedArgs = isUint8Array ? args : Buffer.from(JSON.stringify(args));
    return serializedArgs;
}

/**
 * Constructs {@link Action} instance representing contract method call.
 *
 * @param methodName the name of the method to call
 * @param args arguments to pass to method. Can be either plain JS object which gets serialized as JSON automatically
 *  or `Uint8Array` instance which represents bytes passed as is.
 * @param gas max amount of gas that method call can use
 * @param deposit amount of NEAR (in yoctoNEAR) to send together with the call
 * @param stringify Convert input arguments into bytes array.
 * @param jsContract  Is contract from JS SDK, skips stringification of arguments.
 */
export function functionCall(methodName: string, args: Uint8Array | object, gas: BN, deposit: BN, stringify = stringifyJsonOrBytes, jsContract = false): Action {
    if(jsContract){
        return new Action({ functionCall: new FunctionCall({ methodName, args, gas, deposit }) });
    }
    return new Action({ functionCall: new FunctionCall({ methodName, args: stringify(args), gas, deposit }) });
}

export function transfer(deposit: BN): Action {
    return new Action({transfer: new Transfer({ deposit }) });
}

export function stake(stake: BN, publicKey: PublicKey): Action {
    return new Action({stake: new Stake({ stake, publicKey }) });
}

export function addKey(publicKey: PublicKey, accessKey: AccessKey): Action {
    return new Action({addKey: new AddKey({ publicKey, accessKey}) });
}

export function deleteKey(publicKey: PublicKey): Action {
    return new Action({deleteKey: new DeleteKey({ publicKey }) });
}

export function deleteAccount(beneficiaryId: string): Action {
    return new Action({deleteAccount: new DeleteAccount({ beneficiaryId }) });
}

export function delegateAction(senderId: string, receiverId: string, actions: Action[], nonce: number, blockHash: Uint8Array, keyPair: KeyPair): Action {
    const publicKey = keyPair.getPublicKey();
    const nonDelegateActions = actions.map((action: Action) => {return new NonDelegateAction({action})});
    const delegateAction = new DelegateAction({senderId, receiverId, actions: nonDelegateActions, nonce, blockHash, publicKey});
    const signature = signDelegateActionData(delegateAction, keyPair);
    return new Action({delegate: new SignedDelegateAction({
        delegateAction: delegateAction,
        signature: signature
    })});
}

function signDelegateActionData(delegateAction: DelegateAction, keyPair: KeyPair): Signature {
    const message =  serialize(SCHEMA, delegateAction);
    const hash = new Uint8Array(sha256.sha256.array(message));
    const signature = keyPair.sign(hash);

    return new Signature({ keyType: keyPair.getPublicKey().keyType, data: signature.signature });
}

export class Signature extends Assignable {
    keyType: KeyType;
    data: Uint8Array;
}

export class Transaction extends Assignable {
    signerId: string;
    publicKey: PublicKey;
    nonce: number;
    receiverId: string;
    actions: Action[];
    blockHash: Uint8Array;

    encode(): Uint8Array {
        return serialize(SCHEMA, this);
    }

    static decode(bytes: Buffer): Transaction {
        return deserialize(SCHEMA, Transaction, bytes);
    }
}

export class SignedTransaction extends Assignable {
    transaction: Transaction;
    signature: Signature;

    encode(): Uint8Array {
        return serialize(SCHEMA, this);
    }

    static decode(bytes: Buffer): SignedTransaction {
        return deserialize(SCHEMA, SignedTransaction, bytes);
    }
}

/**
 * Contains a list of the valid transaction Actions available with this API
 * @see {@link https://nomicon.io/RuntimeSpec/Actions.html | Actions Spec}
 */
export class Action extends Enum {
    createAccount: CreateAccount;
    deployContract: DeployContract;
    functionCall: FunctionCall;
    transfer: Transfer;
    stake: Stake;
    addKey: AddKey;
    deleteKey: DeleteKey;
    deleteAccount: DeleteAccount;
    delegate: SignedDelegateAction;
}

export const SCHEMA = new Map<Function, any>([
    [Signature, {kind: 'struct', fields: [
        ['keyType', 'u8'],
        ['data', [64]]
    ]}],
    [SignedTransaction, {kind: 'struct', fields: [
        ['transaction', Transaction],
        ['signature', Signature]
    ]}],
    [Transaction, { kind: 'struct', fields: [
        ['signerId', 'string'],
        ['publicKey', PublicKey],
        ['nonce', 'u64'],
        ['receiverId', 'string'],
        ['blockHash', [32]],
        ['actions', [Action]]
    ]}],
    [PublicKey, { kind: 'struct', fields: [
        ['keyType', 'u8'],
        ['data', [32]]
    ]}],
    [AccessKey, { kind: 'struct', fields: [
        ['nonce', 'u64'],
        ['permission', AccessKeyPermission],
    ]}],
    [AccessKeyPermission, {kind: 'enum', field: 'enum', values: [
        ['functionCall', FunctionCallPermission],
        ['fullAccess', FullAccessPermission],
    ]}],
    [FunctionCallPermission, {kind: 'struct', fields: [
        ['allowance', {kind: 'option', type: 'u128'}],
        ['receiverId', 'string'],
        ['methodNames', ['string']],
    ]}],
    [FullAccessPermission, {kind: 'struct', fields: []}],
    [Action, {kind: 'enum', field: 'enum', values: [
        ['createAccount', CreateAccount],
        ['deployContract', DeployContract],
        ['functionCall', FunctionCall],
        ['transfer', Transfer],
        ['stake', Stake],
        ['addKey', AddKey],
        ['deleteKey', DeleteKey],
        ['deleteAccount', DeleteAccount],
        ['delegate', SignedDelegateAction]
    ]}],
    [CreateAccount, { kind: 'struct', fields: [] }],
    [DeployContract, { kind: 'struct', fields: [
        ['code', ['u8']]
    ]}],
    [FunctionCall, { kind: 'struct', fields: [
        ['methodName', 'string'],
        ['args', ['u8']],
        ['gas', 'u64'],
        ['deposit', 'u128']
    ]}],
    [Transfer, { kind: 'struct', fields: [
        ['deposit', 'u128']
    ]}],
    [Stake, { kind: 'struct', fields: [
        ['stake', 'u128'],
        ['publicKey', PublicKey]
    ]}],
    [AddKey, { kind: 'struct', fields: [
        ['publicKey', PublicKey],
        ['accessKey', AccessKey]
    ]}],
    [DeleteKey, { kind: 'struct', fields: [
        ['publicKey', PublicKey]
    ]}],
    [DeleteAccount, { kind: 'struct', fields: [
        ['beneficiaryId', 'string']
    ]}],
    [NonDelegateAction, { kind: 'struct', fields: [
        ['action', Action],
    ]}],
    [DelegateAction, { kind: 'struct', fields: [
        ['senderId', 'string'],
        ['receiverId', 'string'],
        ['actions', [NonDelegateAction]],
        ['nonce', 'u64'],
        ['blockHash', [32]],
        ['publicKey', PublicKey],
    ]}],
    [SignedDelegateAction, { kind: 'struct', fields: [
        ['delegateAction', DelegateAction],
        ['signature', Signature],
    ]}],
]);

export function createTransaction(signerId: string, publicKey: PublicKey, receiverId: string, nonce: number, actions: Action[], blockHash: Uint8Array): Transaction {
    return new Transaction({ signerId, publicKey, nonce, receiverId, actions, blockHash });
}

/**
 * Signs a given transaction from an account with given keys, applied to the given network
 * @param transaction The Transaction object to sign
 * @param signer The {Signer} object that assists with signing keys
 * @param accountId The human-readable NEAR account name
 * @param networkId The targeted network. (ex. default, betanet, etc…)
 */
async function signTransactionObject(transaction: Transaction, signer: Signer, accountId?: string, networkId?: string): Promise<[Uint8Array, SignedTransaction]> {
    const message = serialize(SCHEMA, transaction);
    const hash = new Uint8Array(sha256.sha256.array(message));
    const signature = await signer.signMessage(message, accountId, networkId);
    const signedTx = new SignedTransaction({
        transaction,
        signature: new Signature({ keyType: transaction.publicKey.keyType, data: signature.signature })
    });
    return [hash, signedTx];
}

export async function signTransaction(transaction: Transaction, signer: Signer, accountId?: string, networkId?: string): Promise<[Uint8Array, SignedTransaction]>;
export async function signTransaction(receiverId: string, nonce: number, actions: Action[], blockHash: Uint8Array, signer: Signer, accountId?: string, networkId?: string): Promise<[Uint8Array, SignedTransaction]>;
export async function signTransaction(...args): Promise<[Uint8Array, SignedTransaction]> {
    if (args[0].constructor === Transaction) {
        const [ transaction, signer, accountId, networkId ] = args;
        return signTransactionObject(transaction, signer, accountId, networkId);
    } else {
        const [ receiverId, nonce, actions, blockHash, signer, accountId, networkId ] = args;
        const publicKey = await signer.getPublicKey(accountId, networkId);
        const transaction = createTransaction(accountId, publicKey, receiverId, nonce, actions, blockHash);
        return signTransactionObject(transaction, signer, accountId, networkId);
    }
}
