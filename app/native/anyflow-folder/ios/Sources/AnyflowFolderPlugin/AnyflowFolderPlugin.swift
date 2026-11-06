import Foundation
import Capacitor
import UIKit
import UniformTypeIdentifiers
import Security

/// The downloads folder on the iPad: a folder the person picks in Files ("On My iPad" or iCloud Drive).
/// Unlike the app's own folder it stays when the app is deleted. Access to it is kept as a bookmark in
/// the app's settings and in the keychain (which outlives a reinstall), so the folder can come back on
/// its own; if it can't, the person picks it again and the library is read from the folder.
@objc(AnyflowFolderPlugin)
public class AnyflowFolderPlugin: CAPPlugin, CAPBridgedPlugin, UIDocumentPickerDelegate {
    public let identifier = "AnyflowFolderPlugin"
    public let jsName = "AnyflowFolder"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pick", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "restore", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "forget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "write", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "read", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "list", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "adopt", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "space", returnType: CAPPluginReturnPromise)
    ]

    private static let key = "anyflow.downloads.folder"
    private var root: URL?
    private var pickCall: CAPPluginCall?

    // MARK: the folder

    @objc func pick(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let vc = self.bridge?.viewController else {
                call.reject("Нет окна для выбора папки")
                return
            }
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder], asCopy: false)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            self.pickCall = call
            vc.present(picker, animated: true)
        }
    }

    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pickCall else { return }
        pickCall = nil
        guard let url = urls.first else {
            call.resolve([:])
            return
        }
        if insideApp(url) {
            call.reject("Эта папка лежит внутри приложения и удалится вместе с ним. Выбери папку в «На iPad» или iCloud Drive.", "INSIDE_APP")
            return
        }
        let scoped = url.startAccessingSecurityScopedResource()
        do {
            let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
            save(data)
            if let old = root, old != url { old.stopAccessingSecurityScopedResource() }
            root = url
            call.resolve(["name": url.lastPathComponent])
        } catch {
            if scoped { url.stopAccessingSecurityScopedResource() }
            call.reject("Не удалось запомнить папку: \(error.localizedDescription)")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickCall?.resolve([:])
        pickCall = nil
    }

    @objc func restore(_ call: CAPPluginCall) {
        guard let data = load() else {
            call.resolve([:])
            return
        }
        var stale = false
        guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale) else {
            call.resolve(["lost": ""])
            return
        }
        _ = url.startAccessingSecurityScopedResource()
        guard (try? url.checkResourceIsReachable()) == true, FileManager.default.isWritableFile(atPath: url.path) else {
            url.stopAccessingSecurityScopedResource()
            call.resolve(["lost": url.lastPathComponent])
            return
        }
        if stale, let fresh = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
            save(fresh)
        }
        root = url
        call.resolve(["name": url.lastPathComponent])
    }

    @objc func forget(_ call: CAPPluginCall) {
        root?.stopAccessingSecurityScopedResource()
        root = nil
        UserDefaults.standard.removeObject(forKey: Self.key)
        SecItemDelete(keychainQuery() as CFDictionary)
        call.resolve()
    }

    // MARK: files inside it

    private func file(_ call: CAPPluginCall) -> URL? {
        guard let root = root else {
            call.reject("Папка для загрузок не выбрана", "NO_FOLDER")
            return nil
        }
        let path = call.getString("path") ?? ""
        if path.split(separator: "/").contains("..") {
            call.reject("Недопустимый путь")
            return nil
        }
        return path.isEmpty ? root : root.appendingPathComponent(path)
    }

    @objc func write(_ call: CAPPluginCall) {
        guard let url = file(call) else { return }
        guard let b64 = call.getString("data"), let data = Data(base64Encoded: b64) else {
            call.reject("Нет данных для записи")
            return
        }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url, options: .atomic)
            call.resolve()
        } catch {
            call.reject(error.localizedDescription)
        }
    }

    @objc func read(_ call: CAPPluginCall) {
        guard let url = file(call) else { return }
        do {
            let data = try Data(contentsOf: url)
            call.resolve(["data": data.base64EncodedString()])
        } catch {
            call.reject(error.localizedDescription, "NOT_FOUND")
        }
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let url = file(call) else { return }
        try? FileManager.default.removeItem(at: url)
        call.resolve()
    }

    @objc func list(_ call: CAPPluginCall) {
        guard let url = file(call) else { return }
        let names = (try? FileManager.default.contentsOfDirectory(atPath: url.path)) ?? []
        call.resolve(["names": names])
    }

    /// moves what was downloaded into the app's own folder (Documents/<from>) over to the picked folder
    @objc func adopt(_ call: CAPPluginCall) {
        guard let root = root else {
            call.reject("Папка для загрузок не выбрана", "NO_FOLDER")
            return
        }
        let fm = FileManager.default
        guard let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first else {
            call.resolve(["moved": 0, "left": 0])
            return
        }
        let old = docs.appendingPathComponent(call.getString("from") ?? "downloads")
        let names = (try? fm.contentsOfDirectory(atPath: old.path)) ?? []
        var moved = 0
        for name in names {
            let src = old.appendingPathComponent(name)
            let dst = root.appendingPathComponent(name)
            if fm.fileExists(atPath: dst.path) { continue }
            do {
                try fm.moveItem(at: src, to: dst)
                moved += 1
            } catch {
                if (try? fm.copyItem(at: src, to: dst)) != nil {
                    try? fm.removeItem(at: src)
                    moved += 1
                }
            }
        }
        call.resolve(["moved": moved, "left": names.count - moved])
    }

    @objc func space(_ call: CAPPluginCall) {
        guard let root = root,
              let values = try? root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]),
              let free = values.volumeAvailableCapacityForImportantUsage else {
            call.resolve([:])
            return
        }
        call.resolve(["free": Double(free)])
    }

    // MARK: remembering it

    private func insideApp(_ url: URL) -> Bool {
        let picked = url.resolvingSymlinksInPath().path
        let home = URL(fileURLWithPath: NSHomeDirectory()).resolvingSymlinksInPath().path
        return picked == home || picked.hasPrefix(home + "/")
    }

    private func keychainQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.key,
            kSecAttrAccount as String: "folder"
        ]
    }

    private func save(_ data: Data) {
        UserDefaults.standard.set(data, forKey: Self.key)
        let query = keychainQuery()
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    private func load() -> Data? {
        if let data = UserDefaults.standard.data(forKey: Self.key) { return data }
        var query = keychainQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }
}
